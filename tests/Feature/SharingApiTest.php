<?php

namespace Tests\Feature;

use App\Models\FileTransfer;
use App\Models\Room;
use App\Models\RoomMember;
use App\Models\User;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
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

    public function test_room_chat_is_persisted_and_published_without_sending_file_content(): void
    {
        $user = $this->guestUser();
        $room = $this->createRoomWithMember($user);
        config(['services.ably.key' => 'test-key-name:'.str_repeat('s', 32)]);

        Http::fake([
            'https://rest.ably.io/*' => Http::response([], 201),
        ]);

        $response = $this->actingAs($user)->postJson("/api/rooms/{$room->public_id}/messages", [
            'client_message_id' => '08ca4cf7-72b6-4f69-a7c4-ddb299f1c7d2',
            'body' => 'Halo room',
        ]);

        $response->assertCreated()->assertJsonPath('message.body', 'Halo room');
        $this->assertDatabaseHas('chat_messages', [
            'room_id' => $room->getKey(),
            'user_id' => $user->getKey(),
            'body' => 'Halo room',
        ]);

        Http::assertSent(fn ($request) => str_contains($request->url(), 'p2p%3Aroom%3A'.$room->public_id)
            && $request['0']['name'] === 'chat.message'
            && $request['0']['data']['body'] === 'Halo room'
            && ! isset($request['0']['clientId']));
    }

    public function test_ably_token_is_scoped_to_the_joined_room_and_user(): void
    {
        $user = $this->guestUser();
        $room = $this->createRoomWithMember($user);
        $secret = str_repeat('s', 32);
        config(['services.ably.key' => 'test-key-name:'.$secret]);

        $response = $this->actingAs($user)->get("/api/rooms/{$room->public_id}/ably-token");
        $response->assertOk();

        $claims = JWT::decode($response->getContent(), new Key($secret, 'HS256'));

        $this->assertSame((string) $user->getKey(), $claims->{'x-ably-clientId'});
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

    public function test_leaving_a_room_cancels_the_users_active_transfers(): void
    {
        $sender = $this->guestUser();
        $receiver = $this->guestUser();
        $room = $this->createRoomWithMember($sender);
        RoomMember::query()->create([
            'room_id' => $room->getKey(),
            'user_id' => $receiver->getKey(),
            'joined_at' => now(),
            'last_seen_at' => now(),
        ]);
        $transfer = FileTransfer::query()->create([
            'public_id' => '44996ed0-f200-4d3a-98e9-7487eb1527df',
            'client_transfer_id' => '08ca4cf7-72b6-4f69-a7c4-ddb299f1c7d2',
            'room_id' => $room->getKey(),
            'sender_id' => $sender->getKey(),
            'receiver_id' => $receiver->getKey(),
            'file_name' => 'photo.png',
            'mime_type' => 'image/png',
            'file_size' => 1024,
            'status' => 'accepted',
        ]);
        config(['services.ably.key' => 'test-key-name:'.str_repeat('s', 32)]);

        Http::fake([
            'https://rest.ably.io/*' => Http::response([], 201),
        ]);

        $this->actingAs($sender)
            ->postJson("/api/rooms/{$room->public_id}/leave")
            ->assertNoContent();

        $this->assertNotNull(RoomMember::query()
            ->where('room_id', $room->getKey())
            ->where('user_id', $sender->getKey())
            ->value('left_at'));
        $this->assertSame('cancelled', $transfer->fresh()->status);
        Http::assertSent(fn ($request) => $request['0']['name'] === 'transfer.updated'
            && $request['0']['data']['id'] === $transfer->public_id
            && $request['0']['data']['status'] === 'cancelled');
    }

    public function test_transfer_requests_create_independent_approval_for_each_recipient(): void
    {
        $sender = $this->guestUser();
        $receiver = $this->guestUser();
        $secondReceiver = $this->guestUser();
        $room = $this->createRoomWithMember($sender);
        foreach ([$receiver, $secondReceiver] as $member) {
            RoomMember::query()->create([
                'room_id' => $room->getKey(),
                'user_id' => $member->getKey(),
                'joined_at' => now(),
                'last_seen_at' => now(),
            ]);
        }
        config(['services.ably.key' => 'test-key-name:'.str_repeat('s', 32)]);

        Http::fake([
            'https://rest.ably.io/*' => Http::response([], 201),
        ]);

        $response = $this->actingAs($sender)->postJson("/api/rooms/{$room->public_id}/transfers", [
            'recipients' => [
                [
                    'client_transfer_id' => '44996ed0-f200-4d3a-98e9-7487eb1527df',
                    'receiver_id' => $receiver->getKey(),
                ],
                [
                    'client_transfer_id' => 'ca623bd3-8796-40a6-b79a-8fdc927b1722',
                    'receiver_id' => $secondReceiver->getKey(),
                ],
            ],
            'file_name' => 'photo.png',
            'mime_type' => 'image/png',
            'file_size' => 1024,
        ]);

        $response->assertCreated()->assertJsonCount(2, 'transfers')
            ->assertJsonPath('transfers.0.status', 'pending')
            ->assertJsonPath('transfers.1.status', 'pending');
        $firstTransferId = $response->json('transfers.0.id');
        $secondTransferId = $response->json('transfers.1.id');
        $firstTransfer = FileTransfer::query()->where('public_id', $firstTransferId)->firstOrFail();
        $secondTransfer = FileTransfer::query()->where('public_id', $secondTransferId)->firstOrFail();

        $this->assertDatabaseHas('file_transfers', [
            'id' => $firstTransfer->getKey(),
            'file_name' => 'photo.png',
            'file_size' => 1024,
            'status' => 'pending',
        ]);
        $this->assertArrayNotHasKey('content', $response->json('transfers.0'));

        $this->actingAs($sender)
            ->postJson("/api/transfers/{$firstTransferId}/accept")
            ->assertForbidden();

        $this->actingAs($receiver)
            ->postJson("/api/transfers/{$firstTransferId}/accept")
            ->assertOk()
            ->assertJsonPath('transfer.status', 'accepted');

        $this->actingAs($secondReceiver)
            ->postJson("/api/transfers/{$secondTransferId}/decline")
            ->assertOk()
            ->assertJsonPath('transfer.status', 'declined');

        $this->assertDatabaseHas('file_transfers', [
            'id' => $firstTransfer->getKey(),
            'status' => 'accepted',
        ]);
        $this->assertDatabaseHas('file_transfers', [
            'id' => $secondTransfer->getKey(),
            'status' => 'declined',
        ]);
        Http::assertSentCount(4);
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
