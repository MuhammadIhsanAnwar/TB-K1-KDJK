<?php

namespace App\Services;

use App\Models\Room;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class AblyPublisher
{
    public function publish(Room $room, string $event, array $data): void
    {
        [$keyName, $secret] = app(AblyCredentials::class)->keyParts();
        $channel = rawurlencode(app(AblyCredentials::class)->roomChannel($room->public_id));

        $response = Http::withBasicAuth($keyName, $secret)
            ->acceptJson()
            ->timeout(8)
            ->post("https://rest.ably.io/channels/{$channel}/messages", [[
                'name' => $event,
                'data' => $data,
            ]]);

        if (! $response->successful()) {
            $errorCode = $response->json('error.code');
            Log::warning('Ably server publish was rejected.', [
                'status' => $response->status(),
                'error_code' => is_numeric($errorCode) ? (int) $errorCode : null,
            ]);

            throw new RuntimeException('Ably rejected a server publish (HTTP '.$response->status().').');
        }
    }
}
