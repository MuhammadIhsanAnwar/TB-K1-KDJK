<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AblyPresenceService;
use App\Services\AblyTokenService;
use App\Services\NetworkFingerprintService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
use Illuminate\Support\Facades\Cache;

class RoomController extends Controller
{
    public function createInvitation(Request $request, NetworkFingerprintService $fingerprints): JsonResponse
    {
        $roomId = $request->input('room_id');

        abort_unless(
            is_string($roomId) && preg_match('/\A[A-Z0-9]{12}\z/', $roomId) === 1,
            422,
            'Kode room tidak valid.'
        );

        $roomName = $request->input('room_name');

        if ($roomName !== null) {
            abort_unless(
                is_string($roomName),
                422,
                'Nama room tidak valid.'
            );

            $roomName = trim(preg_replace('/\s+/u', ' ', $roomName));

            abort_unless(
                $roomName !== ''
                && mb_strlen($roomName) <= 40
                && preg_match('/[\x00-\x1F\x7F]/u', $roomName) !== 1,
                422,
                'Nama room tidak valid.'
            );

            Cache::put(
                'nonovshare:room-name:' . $roomId,
                $roomName,
                now()->addDays(30)
            );
        }

        return response()->json([
            'room_proof' => $fingerprints->roomProof(
                $roomId,
                $this->clientIpAddress($request)
            ),
            'room_name' => Cache::get('nonovshare:room-name:' . $roomId),
        ])->header('Cache-Control', 'no-store, private');
    }

    public function clientIp(
    Request $request,
    NetworkFingerprintService $fingerprints,
    ): JsonResponse {
        $ipAddress = $this->clientIpAddress($request);

        return response()->json([
            'client_ip' => $ipAddress,
            'network_fingerprint' => $fingerprints->forNetwork($ipAddress),
        ])->header('Cache-Control', 'no-store, private');
    }
    public function networkAblyToken(
        Request $request,
        AblyTokenService $tokens,
    ): Response {
        $clientId = $request->query('client_id');

        abort_unless(
            is_string($clientId) && Str::isUuid($clientId),
            422,
            'Identitas browser tidak valid.',
        );

        $ipAddress = $this->clientIpAddress($request);

        return response($tokens->issueForNetwork($clientId, $ipAddress))
            ->header('Content-Type', 'text/plain; charset=UTF-8')
            ->header('Cache-Control', 'no-store, private');
    }

    public function networkFingerprint(
        Request $request,
        string $roomId,
        NetworkFingerprintService $fingerprints,
        AblyPresenceService $presence,
    ): JsonResponse {
        $this->validateRoomId($roomId);
        $ipAddress = $this->clientIpAddress($request);
        $roomProof = $this->roomProof($request->query('proof'), required: true);
        abort_unless(
            $presence->allowsNetwork($roomId, $ipAddress, $roomProof),
            404,
            'Room tidak ditemukan.',
        );

        return response()->json([
            'network_fingerprint' => $fingerprints->forRoom($roomId, $ipAddress),
            'client_ip' => $ipAddress,
        ])->header('Cache-Control', 'no-store, private');
    }

    public function ablyToken(
        Request $request,
        string $roomId,
        AblyTokenService $tokens,
        AblyPresenceService $presence,
    ): Response {
        $this->validateRoomId($roomId);

        $clientId = $request->query('client_id');
        abort_unless(is_string($clientId) && Str::isUuid($clientId), 422, 'Identitas browser tidak valid.');

        $ipAddress = $this->clientIpAddress($request);
        $roomProof = $this->roomProof($request->query('room_proof'), required: true);
        abort_unless(
            $presence->allowsNetwork($roomId, $ipAddress, $roomProof),
            404,
            'Room tidak ditemukan.',
        );

        return response($tokens->issueForRoom($roomId, $clientId, $ipAddress, $roomProof))
            ->header('Content-Type', 'text/plain; charset=UTF-8')
            ->header('Cache-Control', 'no-store, private');
    }

    private function clientIpAddress(Request $request): string
    {
        $ipAddress = $request->ip();
        abort_unless(
            is_string($ipAddress) && filter_var($ipAddress, FILTER_VALIDATE_IP) !== false,
            503,
            'Alamat IP tidak dapat diverifikasi.',
        );

        return $ipAddress;
    }

    private function roomProof(mixed $proof, bool $required = false): ?string
    {
        if ($proof === null) {
            abort_unless(
                ! $required,
                422,
                'Undangan room tidak lengkap. Gunakan tautan undangan atau kode lengkap ROOMID.PROOF.',
            );

            return null;
        }

        abort_unless(is_string($proof) && preg_match('/\A[a-f0-9]{32}\z/i', $proof) === 1, 404);

        return strtolower($proof);
    }

    private function validateRoomId(string $roomId): void
    {
        abort_unless(preg_match('/\A[A-Z0-9]{12}\z/', $roomId) === 1, 404);
    }
}
