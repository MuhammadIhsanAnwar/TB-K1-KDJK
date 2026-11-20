<?php

namespace App\Services;

use App\Models\Room;
use RuntimeException;

class NetworkFingerprintService
{
    public function forRoom(Room $room, string $ipAddress): string
    {
        $appKey = config('app.key');

        if (! is_string($appKey) || $appKey === '') {
            throw new RuntimeException('The application key is required to verify room networks.');
        }

        return hash_hmac('sha256', $room->public_id.'|'.$ipAddress, $appKey);
    }
}
