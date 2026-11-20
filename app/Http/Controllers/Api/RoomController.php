<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AblyTokenService;
use App\Services\NetworkFingerprintService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class RoomController extends Controller
{
    public function networkFingerprint(
        Request $request,
        string $roomId,
        NetworkFingerprintService $fingerprints,
    ): JsonResponse {
        $this->validateRoomId($roomId);
        $ipAddress = $request->ip();
        abort_if(! is_string($ipAddress) || $ipAddress === '', 503, 'Alamat jaringan tidak dapat diverifikasi.');

        return response()->json([
            'network_fingerprint' => $fingerprints->forRoom($roomId, $ipAddress),
        ])->header('Cache-Control', 'no-store, private');
    }

    public function ablyToken(
        Request $request,
        string $roomId,
        AblyTokenService $tokens,
    ): Response {
        $this->validateRoomId($roomId);

        $clientId = $request->query('client_id');
        abort_unless(is_string($clientId) && Str::isUuid($clientId), 422, 'Identitas browser tidak valid.');

        $ipAddress = $request->ip();
        abort_if(! is_string($ipAddress) || $ipAddress === '', 503, 'Alamat jaringan tidak dapat diverifikasi.');

        return response($tokens->issueForRoom($roomId, $clientId, $ipAddress))
            ->header('Content-Type', 'text/plain; charset=UTF-8')
            ->header('Cache-Control', 'no-store, private');
    }

    private function validateRoomId(string $roomId): void
    {
        abort_unless(preg_match('/\A[A-Z0-9]{12}\z/', $roomId) === 1, 404);
    }
}
