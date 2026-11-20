<?php

namespace Tests\Feature;

use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

class SharingApiTest extends TestCase
{
    public function test_the_homepage_loads_without_a_database_user_or_session(): void
    {
        config(['database.default' => 'p2p-no-database']);

        $this->get('/')
            ->assertOk()
            ->assertSee('Buat room baru')
            ->assertSee('Punya kode undangan?');
    }

    public function test_database_backed_room_and_message_endpoints_are_removed(): void
    {
        config(['database.default' => 'p2p-no-database']);

        $this->getJson('/api/rooms')->assertNotFound();
        $this->postJson('/api/rooms')->assertNotFound();
        $this->postJson('/api/rooms/join')->assertNotFound();
        $this->postJson('/api/rooms/ABCDEF234567/messages')->assertNotFound();
        $this->postJson('/api/rooms/ABCDEF234567/transfers')->assertNotFound();
        $this->getJson('/api/rooms/ABCDEF234567/history')->assertNotFound();
    }

    public function test_public_ip_endpoint_works_without_a_database(): void
    {
        config(['database.default' => 'p2p-no-database']);

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.42'])
            ->getJson('/api/network')
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('client_ip', '203.0.113.42');
    }

    public function test_room_invitation_proof_is_bound_to_the_creator_public_ip(): void
    {
        config(['database.default' => 'p2p-no-database']);
        $roomId = 'ABCDEF234567';
        $ipAddress = '203.0.113.42';

        $this->withServerVariables(['REMOTE_ADDR' => $ipAddress])
            ->postJson('/api/rooms/invitation', ['room_id' => $roomId])
            ->assertOk()
            ->assertJsonPath(
                'room_proof',
                substr(hash_hmac('sha256', 'room-invite|'.$roomId.'|'.$ipAddress, (string) config('app.key')), 0, 32),
            );
    }

    public function test_network_check_returns_a_room_scoped_fingerprint_and_public_ip(): void
    {
        config(['database.default' => 'p2p-no-database']);
        config(['services.ably.key' => 'test-key-name:'.str_repeat('s', 32)]);
        Http::fake(['https://rest.ably.io/*' => Http::response([], 200)]);
        $roomId = 'ABCDEF234567';
        $ipAddress = '203.0.113.42';
        $proof = substr(hash_hmac('sha256', 'room-invite|'.$roomId.'|'.$ipAddress, (string) config('app.key')), 0, 32);

        $response = $this->withServerVariables(['REMOTE_ADDR' => $ipAddress])
            ->getJson("/api/rooms/{$roomId}/network?proof={$proof}");

        $response->assertOk()->assertHeader('Cache-Control', 'no-store, private');
        $fingerprint = $response->json('network_fingerprint');
        $this->assertSame($ipAddress, $response->json('client_ip'));
        $this->assertSame(
            hash_hmac('sha256', $roomId.'|'.$ipAddress, (string) config('app.key')),
            $fingerprint,
        );

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.43'])
            ->getJson("/api/rooms/{$roomId}/network")
            ->assertNotFound();
    }

    public function test_ably_token_binds_browser_identity_to_the_same_ip_fingerprint(): void
    {
        config(['database.default' => 'p2p-no-database']);
        $roomId = 'ABCDEF234567';
        $clientId = (string) Str::uuid();
        $ipAddress = '203.0.113.42';
        $secret = str_repeat('s', 32);
        config(['services.ably.key' => 'test-key-name:'.$secret]);
        Http::fake(['https://rest.ably.io/*' => Http::response([], 200)]);
        $proof = substr(hash_hmac('sha256', 'room-invite|'.$roomId.'|'.$ipAddress, (string) config('app.key')), 0, 32);

        $response = $this->withServerVariables(['REMOTE_ADDR' => $ipAddress])
            ->get("/api/rooms/{$roomId}/ably-token?client_id={$clientId}&room_proof={$proof}");
        $response->assertOk()->assertHeader('Cache-Control', 'no-store, private');

        $claims = JWT::decode($response->getContent(), new Key($secret, 'HS256'));
        $fingerprint = hash_hmac('sha256', $roomId.'|'.$ipAddress, (string) config('app.key'));

        $encodedIp = rtrim(strtr(base64_encode($ipAddress), '+/', '-_'), '=');
        $this->assertSame($clientId.':'.$fingerprint.':'.$encodedIp, $claims->{'x-ably-clientId'});
        $this->assertSame([
            'p2p:room:'.$roomId.':'.$proof => ['publish', 'subscribe', 'presence'],
        ], json_decode($claims->{'x-ably-capability'}, true, 512, JSON_THROW_ON_ERROR));
    }

    public function test_users_on_a_different_public_ip_cannot_discover_or_join_an_active_room(): void
    {
        config(['database.default' => 'p2p-no-database']);
        config(['services.ably.key' => 'test-key-name:'.str_repeat('s', 32)]);
        $roomId = 'ABCDEF234567';
        $creatorIp = '203.0.113.42';
        $attackerIp = '203.0.113.99';
        $creatorFingerprint = hash_hmac('sha256', $roomId.'|'.$creatorIp, (string) config('app.key'));
        $creatorProof = substr(hash_hmac('sha256', 'room-invite|'.$roomId.'|'.$creatorIp, (string) config('app.key')), 0, 32);
        $encodedIp = rtrim(strtr(base64_encode($creatorIp), '+/', '-_'), '=');
        $creatorClientId = Str::uuid().':'.$creatorFingerprint.':'.$encodedIp;
        Http::fake([
            'https://rest.ably.io/*' => Http::response([
                ['clientId' => $creatorClientId],
            ], 200),
        ]);

        $this->withServerVariables(['REMOTE_ADDR' => $attackerIp])
            ->getJson("/api/rooms/{$roomId}/network?proof={$creatorProof}")
            ->assertNotFound();

        $this->withServerVariables(['REMOTE_ADDR' => $attackerIp])
            ->get("/api/rooms/{$roomId}/ably-token?client_id=".Str::uuid()."&room_proof={$creatorProof}")
            ->assertNotFound();
    }

    public function test_a_room_code_without_its_invitation_proof_cannot_create_an_empty_room(): void
    {
        config(['database.default' => 'p2p-no-database']);
        config(['services.ably.key' => 'test-key-name:'.str_repeat('s', 32)]);
        Http::fake(['https://rest.ably.io/*' => Http::response([], 200)]);

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.99'])
            ->getJson('/api/rooms/ABCDEF234567/network')
            ->assertNotFound();
    }

    public function test_legacy_active_room_only_allows_users_on_its_current_public_ip(): void
    {
        config(['database.default' => 'p2p-no-database']);
        config(['services.ably.key' => 'test-key-name:'.str_repeat('s', 32)]);
        $roomId = 'ABCDEF234567';
        $ipAddress = '203.0.113.42';
        $fingerprint = hash_hmac('sha256', $roomId.'|'.$ipAddress, (string) config('app.key'));
        Http::fake([
            'https://rest.ably.io/*' => Http::response([
                ['clientId' => Str::uuid().':'.$fingerprint],
            ], 200),
        ]);

        $this->withServerVariables(['REMOTE_ADDR' => $ipAddress])
            ->getJson("/api/rooms/{$roomId}/network")
            ->assertOk()
            ->assertJsonPath('client_ip', $ipAddress)
            ->assertJsonPath('network_fingerprint', $fingerprint);

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.99'])
            ->getJson("/api/rooms/{$roomId}/network")
            ->assertNotFound();
    }

    public function test_network_and_token_endpoints_reject_invalid_room_codes_and_client_ids(): void
    {
        config(['database.default' => 'p2p-no-database']);

        $this->getJson('/api/rooms/invalid/network')->assertNotFound();
        $this->get('/api/rooms/ABCDEF234567/ably-token?client_id=not-a-uuid')->assertUnprocessable();
    }
}
