<?php

namespace Tests\Feature;

use Firebase\JWT\JWT;
use Firebase\JWT\Key;
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

    public function test_network_check_returns_a_room_scoped_ip_fingerprint_without_raw_ip(): void
    {
        config(['database.default' => 'p2p-no-database']);
        $roomId = 'ABCDEF234567';
        $ipAddress = '203.0.113.42';

        $response = $this->withServerVariables(['REMOTE_ADDR' => $ipAddress])
            ->getJson("/api/rooms/{$roomId}/network");

        $response->assertOk()->assertHeader('Cache-Control', 'no-store, private');
        $fingerprint = $response->json('network_fingerprint');
        $this->assertSame(
            hash_hmac('sha256', $roomId.'|'.$ipAddress, (string) config('app.key')),
            $fingerprint,
        );
        $this->assertStringNotContainsString($ipAddress, $response->getContent());

        $differentIp = $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.43'])
            ->getJson("/api/rooms/{$roomId}/network")
            ->json('network_fingerprint');
        $this->assertNotSame($fingerprint, $differentIp);
    }

    public function test_ably_token_binds_browser_identity_to_the_same_ip_fingerprint(): void
    {
        config(['database.default' => 'p2p-no-database']);
        $roomId = 'ABCDEF234567';
        $clientId = (string) Str::uuid();
        $ipAddress = '203.0.113.42';
        $secret = str_repeat('s', 32);
        config(['services.ably.key' => 'test-key-name:'.$secret]);

        $response = $this->withServerVariables(['REMOTE_ADDR' => $ipAddress])
            ->get("/api/rooms/{$roomId}/ably-token?client_id={$clientId}");
        $response->assertOk()->assertHeader('Cache-Control', 'no-store, private');

        $claims = JWT::decode($response->getContent(), new Key($secret, 'HS256'));
        $fingerprint = hash_hmac('sha256', $roomId.'|'.$ipAddress, (string) config('app.key'));

        $this->assertSame($clientId.':'.$fingerprint, $claims->{'x-ably-clientId'});
        $this->assertSame([
            'p2p:room:'.$roomId => ['publish', 'subscribe', 'presence'],
        ], json_decode($claims->{'x-ably-capability'}, true, 512, JSON_THROW_ON_ERROR));
    }

    public function test_network_and_token_endpoints_reject_invalid_room_codes_and_client_ids(): void
    {
        config(['database.default' => 'p2p-no-database']);

        $this->getJson('/api/rooms/invalid/network')->assertNotFound();
        $this->get('/api/rooms/ABCDEF234567/ably-token?client_id=not-a-uuid')->assertUnprocessable();
    }
}
