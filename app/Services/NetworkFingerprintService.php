<?php

namespace App\Services;

use RuntimeException;

class NetworkFingerprintService
{
    public function forRoom(string $roomId, string $ipAddress): string
    {
        $appKey = config('app.key');

        if (! is_string($appKey) || $appKey === '') {
            throw new RuntimeException('The application key is required to verify room networks.');
        }

        return hash_hmac('sha256', $roomId.'|'.$ipAddress, $appKey);
    }
}
