<?php

namespace App\Services;

class AblyPresenceService
{
    public function __construct(private NetworkFingerprintService $fingerprints) {}

    public function allowsNetwork(string $roomId, string $ipAddress, string $roomProof): bool
    {
        return $this->fingerprints->verifiesRoomProof($roomId, $ipAddress, $roomProof);
    }
}
