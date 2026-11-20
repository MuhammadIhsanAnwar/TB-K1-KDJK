<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

class AblyPresenceService
{
    public function __construct(private NetworkFingerprintService $fingerprints) {}

    public function allowsNetwork(string $roomId, string $ipAddress, ?string $roomProof = null): bool
    {
        if ($roomProof !== null) {
            return $this->fingerprints->verifiesRoomProof($roomId, $ipAddress, $roomProof);
        }

        [$keyName, $secret] = app(AblyCredentials::class)->keyParts();
        try {
            $response = Http::acceptJson()
                ->withBasicAuth($keyName, $secret)
                ->connectTimeout(3)
                ->timeout(5)
                ->get(
                    'https://rest.ably.io/channels/'.rawurlencode(app(AblyCredentials::class)->roomChannel($roomId)).'/presence',
                    ['limit' => 1000],
                );
        } catch (ConnectionException $exception) {
            report($exception);
            abort(503, 'Status room tidak dapat diverifikasi melalui Ably.');
        }

        abort_unless($response->successful(), 503, 'Status room tidak dapat diverifikasi melalui Ably.');
        abort_if(str_contains((string) $response->header('Link'), 'rel="next"'), 503, 'Jumlah peserta room terlalu besar untuk diverifikasi.');

        $members = $response->json();
        abort_unless(is_array($members), 503, 'Data kehadiran room dari Ably tidak valid.');
        if ($members === []) {
            return false;
        }

        $expectedFingerprint = $this->fingerprints->forRoom($roomId, $ipAddress);

        foreach ($members as $member) {
            $clientId = is_array($member) ? ($member['clientId'] ?? null) : null;
            if (
                ! is_string($clientId)
                || preg_match('/\A[0-9a-f-]{36}:([a-f0-9]{64})(?::[A-Za-z0-9_-]+)?\z/i', $clientId, $matches) !== 1
            ) {
                abort(503, 'Identitas peserta room dari Ably tidak valid.');
            }

            if (! hash_equals($expectedFingerprint, strtolower($matches[1]))) {
                return false;
            }
        }

        return true;
    }
}
