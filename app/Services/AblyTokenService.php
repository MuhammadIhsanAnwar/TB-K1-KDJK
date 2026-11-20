<?php

namespace App\Services;

use Firebase\JWT\JWT;
use Illuminate\Support\Carbon;

class AblyTokenService
{
    public function __construct(private NetworkFingerprintService $fingerprints) {}

    public function issueForRoom(string $roomId, string $clientId, string $ipAddress): string
    {
        [$keyName, $secret] = app(AblyCredentials::class)->keyParts();
        $networkFingerprint = $this->fingerprints->forRoom($roomId, $ipAddress);
        $now = Carbon::now()->timestamp;
        $capability = json_encode([
            app(AblyCredentials::class)->roomChannel($roomId) => [
                'publish',
                'subscribe',
                'presence',
            ],
        ], JSON_THROW_ON_ERROR);

        return JWT::encode([
            'iat' => $now,
            'exp' => $now + 600,
            'x-ably-capability' => $capability,
            'x-ably-clientId' => $clientId.':'.$networkFingerprint,
        ], $secret, 'HS256', $keyName);
    }
}
