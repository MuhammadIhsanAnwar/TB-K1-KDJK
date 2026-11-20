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
use Tests\TestCase;

class SharingApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_user_can_register_and_create_a_room(): void
    {
        $this->postJson('/api/auth/register', [
            'name' => 'Ayu',
            'email' => 'ayu@example.test',
            'password' => 'StrongPass123',
            'password_confirmation' => 'StrongPass123',
        ])->assertCreated()
            ->assertJsonPath('user.name', 'Ayu');

        $response = $this->postJson('/api/rooms', ['name' => 'Diskusi']);
        $response->assertCreated()->assertJsonPath('room.name', 'Diskusi');

        $roomId = $response->json('room.id');
        $room = Room::query()->where('public_id', $roomId)->firstOrFail();

        $this->assertDatabaseHas('room_members', [
            'room_id' => $room->getKey(),
            'user_id' => User::query()->where('email', 'ayu@example.test')->value('id'),
            'left_at' => null,
        ]);
    }

    public function test_room_chat_is_persisted_and_published_without_sending_file_content(): void
    {
        $user = User::factory()->create();
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
            && $request['0']['data']['body'] === 'Halo room');
    }

    public function test_ably_token_is_scoped_to_the_joined_room_and_user(): void
    {
        $user = User::factory()->create();
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
        $owner = User::factory()->create();
        $otherUser = User::factory()->create();
        $room = $this->createRoomWithMember($owner);

        $this->actingAs($otherUser)
            ->get("/api/rooms/{$room->public_id}/ably-token")
            ->assertNotFound();
    }

    public function test_joining_an_existing_room_refreshes_the_membership_activity(): void
    {
        $user = User::factory()->create();
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
        $sender = User::factory()->create();
        $receiver = User::factory()->create();
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

    public function test_transfer_requests_store_metadata_and_allow_only_the_recipient_to_accept(): void
    {
        $sender = User::factory()->create();
        $receiver = User::factory()->create();
        $room = $this->createRoomWithMember($sender);
        RoomMember::query()->create([
            'room_id' => $room->getKey(),
            'user_id' => $receiver->getKey(),
            'joined_at' => now(),
            'last_seen_at' => now(),
        ]);
        config(['services.ably.key' => 'test-key-name:'.str_repeat('s', 32)]);

        Http::fake([
            'https://rest.ably.io/*' => Http::response([], 201),
        ]);

        $response = $this->actingAs($sender)->postJson("/api/rooms/{$room->public_id}/transfers", [
            'client_transfer_id' => '44996ed0-f200-4d3a-98e9-7487eb1527df',
            'receiver_id' => $receiver->getKey(),
            'file_name' => 'photo.png',
            'mime_type' => 'image/png',
            'file_size' => 1024,
        ]);

        $response->assertCreated()->assertJsonPath('transfer.status', 'pending');
        $transferId = $response->json('transfer.id');
        $transfer = FileTransfer::query()->where('public_id', $transferId)->firstOrFail();

        $this->assertDatabaseHas('file_transfers', [
            'id' => $transfer->getKey(),
            'file_name' => 'photo.png',
            'file_size' => 1024,
            'status' => 'pending',
        ]);
        $this->assertArrayNotHasKey('content', $response->json('transfer'));

        $this->actingAs($sender)
            ->postJson("/api/transfers/{$transferId}/accept")
            ->assertForbidden();

        $this->actingAs($receiver)
            ->postJson("/api/transfers/{$transferId}/accept")
            ->assertOk()
            ->assertJsonPath('transfer.status', 'accepted');

        $this->assertDatabaseHas('file_transfers', [
            'id' => $transfer->getKey(),
            'status' => 'accepted',
        ]);
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
}
