<?php

namespace App\Services;

use RuntimeException;

class AblyCredentials
{
    /**
     * @return array{0: string, 1: string}
     */
    public function keyParts(): array
    {
        $key = config('services.ably.key');

        if (! is_string($key) || ! str_contains($key, ':')) {
            throw new RuntimeException('The Ably API key is missing or malformed.');
        }

        [$keyName, $secret] = explode(':', $key, 2);

        if ($keyName === '' || $secret === '') {
            throw new RuntimeException('The Ably API key is missing or malformed.');
        }

        return [$keyName, $secret];
    }

    public function roomChannel(string $roomId, ?string $roomProof = null): string
    {
        return 'p2p:room:'.$roomId.($roomProof === null ? '' : ':'.$roomProof);
    }
    public function networkChannel(string $fingerprint): string
    {
    return 'p2p:network:'.$fingerprint;
    }
}
