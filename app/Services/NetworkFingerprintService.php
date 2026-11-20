<?php

namespace App\Services;

use RuntimeException;

class NetworkFingerprintService
{
    public function forRoom(string $roomId, string $ipAddress): string
    {
        return hash_hmac('sha256', $roomId.'|'.$ipAddress, $this->appKey());
    }

    public function roomProof(string $roomId, string $ipAddress): string
    {
        return substr(hash_hmac('sha256', 'room-invite|'.$roomId.'|'.$ipAddress, $this->appKey()), 0, 32);
    }

    public function verifiesRoomProof(string $roomId, string $ipAddress, string $proof): bool
    {
        return hash_equals($this->roomProof($roomId, $ipAddress), $proof);
    }

    private function appKey(): string
    {
        $appKey = config('app.key');
        if (! is_string($appKey) || $appKey === '') {
            throw new RuntimeException('The application key is required to verify room networks.');
        }

        return $appKey;
    }
}
