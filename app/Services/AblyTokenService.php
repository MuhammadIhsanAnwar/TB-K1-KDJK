<?php

namespace App\Services;

use App\Models\Room;
use App\Models\User;
use Firebase\JWT\JWT;
use Illuminate\Support\Carbon;

class AblyTokenService
{
    public function issueForRoom(Room $room, User $user): string
    {
        [$keyName, $secret] = app(AblyCredentials::class)->keyParts();
        $now = Carbon::now()->timestamp;
        $capability = json_encode([
            app(AblyCredentials::class)->roomChannel($room->public_id) => [
                'publish',
                'subscribe',
                'presence',
            ],
        ], JSON_THROW_ON_ERROR);

        return JWT::encode([
            'iat' => $now,
            'exp' => $now + 600,
            'x-ably-capability' => $capability,
            'x-ably-clientId' => (string) $user->getKey(),
        ], $secret, 'HS256', $keyName);
    }
}
