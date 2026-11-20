<?php

namespace Tests\Feature;

use App\Models\Room;
use App\Models\RoomMember;
use App\Models\User;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class SharingApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_homepage_is_ready_to_use_without_an_account(): void
    {
        $this->get('/')
            ->assertOk()
            ->assertSee('Buat room baru')
            ->assertDontSee('Masuk ke akun')
            ->assertDontSee('Buat akun baru');
        $this->postJson('/api/auth/register', [])->assertNotFound();
        $this->postJson('/api/auth/login', [])->assertNotFound();

        $this->assertDatabaseCount('users', 1);
        $this->assertStringEndsWith('@guest.invalid', User::query()->value('email'));
    }

    public function test_a_guest_can_create_a_room_without_registering(): void
    {
        $response = $this->postJson('/api/rooms', ['name' => 'Diskusi']);
        $response->assertCreated()->assertJsonPath('room.name', 'Diskusi');

        $roomId = $response->json('room.id');
        $room = Room::query()->where('public_id', $roomId)->firstOrFail();
        $guest = User::query()->findOrFail($room->created_by);

        $this->assertDatabaseHas('room_members', [
            'room_id' => $room->getKey(),
            'user_id' => $guest->getKey(),
            'left_at' => null,
        ]);
        $this->assertStringStartsWith('Tamu-', $guest->name);
    }

    public function test_existing_account_sessions_are_replaced_with_guest_sessions(): void
    {
        $account = User::factory()->create();

        $this->actingAs($account)->get('/')->assertOk();

        $guest = User::query()->where('email', 'like', 'guest-%@guest.invalid')->firstOrFail();
        $this->assertAuthenticatedAs($guest);
    }

    public function test_chat_and_file_transfer_endpoints_do_not_persist_messages_or_metadata(): void
    {
        $user = $this->guestUser();
        $room = $this->createRoomWithMember($user);

        $this->actingAs($user)->postJson("/api/rooms/{$room->public_id}/messages", [
            'client_message_id' => '08ca4cf7-72b6-4f69-a7c4-ddb299f1c7d2',
            'body' => 'Halo room',
        ])->assertNotFound();

        $this->actingAs($user)->postJson("/api/rooms/{$room->public_id}/transfers", [
            'file_name' => 'photo.png',
        ])->assertNotFound();

        $this->assertDatabaseCount('chat_messages', 0);
        $this->assertDatabaseCount('file_transfers', 0);
    }

    public function test_migration_purges_previously_persisted_messages_and_transfer_metadata(): void
    {
        $user = $this->guestUser();
        $room = $this->createRoomWithMember($user);
        $now = now();

        DB::table('chat_messages')->insert([
            'room_id' => $room->getKey(),
            'user_id' => $user->getKey(),
            'client_message_id' => '08ca4cf7-72b6-4f69-a7c4-ddb299f1c7d2',
            'body' => 'Riwayat lama',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('file_transfers')->insert([
            'public_id' => '44996ed0-f200-4d3a-98e9-7487eb1527df',
            'client_transfer_id' => 'ca623bd3-8796-40a6-b79a-8fdc927b1722',
            'room_id' => $room->getKey(),
            'sender_id' => $user->getKey(),
            'receiver_id' => $user->getKey(),
            'file_name' => 'file-lama.pdf',
            'mime_type' => 'application/pdf',
            'file_size' => 1024,
            'status' => 'pending',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $migration = require database_path('migrations/2026_11_20_134500_purge_persisted_chat_and_transfer_data.php');
        $migration->up();

        $this->assertDatabaseCount('chat_messages', 0);
        $this->assertDatabaseCount('file_transfers', 0);
    }

    public function test_ably_token_is_scoped_to_the_joined_room_and_user(): void
    {
        $user = $this->guestUser();
        $room = $this->createRoomWithMember($user);
        $secret = str_repeat('s', 32);
        $clientIp = '203.0.113.42';
        config(['services.ably.key' => 'test-key-name:'.$secret]);

        $response = $this->withServerVariables(['REMOTE_ADDR' => $clientIp])
            ->actingAs($user)
            ->get("/api/rooms/{$room->public_id}/ably-token");
        $response->assertOk();

        $claims = JWT::decode($response->getContent(), new Key($secret, 'HS256'));

        $this->assertSame(
            $user->getKey().':'.hash_hmac('sha256', $room->public_id.'|'.$clientIp, (string) config('app.key')),
            $claims->{'x-ably-clientId'},
        );
        $this->assertSame([
            'p2p:room:'.$room->public_id => ['publish', 'subscribe', 'presence'],
        ], json_decode($claims->{'x-ably-capability'}, true, 512, JSON_THROW_ON_ERROR));
    }

    public function test_a_non_member_cannot_get_a_room_token(): void
    {
        $owner = $this->guestUser();
        $otherUser = $this->guestUser();
        $room = $this->createRoomWithMember($owner);

        $this->actingAs($otherUser)
            ->get("/api/rooms/{$room->public_id}/ably-token")
            ->assertNotFound();
    }

    public function test_joining_an_existing_room_refreshes_the_membership_activity(): void
    {
        $user = $this->guestUser();
        $room = $this->createRoomWithMember($user);
        $membership = RoomMember::query()
            ->where('room_id', $room->getKey())
            ->where('user_id', $user->getKey())
            ->firstOrFail();
        $membership->forceFill(['last_seen_at' => now()->subMinutes(31)])->save();

        $this->actingAs($user)
            ->postJson('/api/rooms/join', ['room_id' => $room->public_id])
            ->assertOk();

        $this->assertTrue($membership->fresh()->last_seen_at->greaterThan(now()->subMinutes(1)));
    }

    public function test_leaving_a_room_only_updates_membership(): void
    {
        $sender = $this->guestUser();
        $room = $this->createRoomWithMember($sender);

        $this->actingAs($sender)
            ->postJson("/api/rooms/{$room->public_id}/leave")
            ->assertNoContent();

        $this->assertNotNull(RoomMember::query()
            ->where('room_id', $room->getKey())
            ->where('user_id', $sender->getKey())
            ->value('left_at'));
    }

    public function test_network_check_returns_only_a_room_scoped_ip_fingerprint(): void
    {
        $user = $this->guestUser();
        $room = $this->createRoomWithMember($user);
        $appKey = config('app.key');

        $response = $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.42'])
            ->actingAs($user)
            ->getJson("/api/rooms/{$room->public_id}/network");

        $response->assertOk()->assertHeader('Cache-Control', 'no-store, private');
        $fingerprint = $response->json('network_fingerprint');
        $this->assertSame(
            hash_hmac('sha256', $room->public_id.'|203.0.113.42', (string) $appKey),
            $fingerprint,
        );
        $this->assertStringNotContainsString('203.0.113.42', $response->getContent());

        $sameIp = $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.42'])
            ->actingAs($user)
            ->getJson("/api/rooms/{$room->public_id}/network")
            ->json('network_fingerprint');
        $differentIp = $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.43'])
            ->actingAs($user)
            ->getJson("/api/rooms/{$room->public_id}/network")
            ->json('network_fingerprint');

        $this->assertSame($fingerprint, $sameIp);
        $this->assertNotSame($fingerprint, $differentIp);
    }

    private function createRoomWithMember(User $user): Room
    {
        $room = Room::query()->create([
            'public_id' => 'ROOMABC12345',
            'name' => 'Test room',
            'created_by' => $user->getKey(),
        ]);

        RoomMember::query()->create([
            'room_id' => $room->getKey(),
            'user_id' => $user->getKey(),
            'joined_at' => now(),
            'last_seen_at' => now(),
        ]);

        return $room;
    }

    private function guestUser(): User
    {
        return User::factory()->create([
            'email' => 'guest-'.Str::uuid().'@guest.invalid',
        ]);
    }
}
