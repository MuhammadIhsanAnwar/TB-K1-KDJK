<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Room;
use App\Services\AblyTokenService;
use App\Services\NetworkFingerprintService;
use App\Services\RoomMembershipService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class RoomController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $rooms = Room::query()
            ->whereHas('members', fn ($query) => $query
                ->where('user_id', $request->user()->getKey())
                ->whereNull('left_at'))
            ->withCount(['members as active_members_count' => fn ($query) => $query
                ->whereNull('left_at')
                ->where('last_seen_at', '>=', now()->subMinutes(30))])
            ->latest('updated_at')
            ->limit(20)
            ->get();

        return response()->json(['rooms' => $rooms->map(fn (Room $room) => $this->roomPayload($room))]);
    }

    public function create(Request $request, RoomMembershipService $memberships): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['nullable', 'string', 'max:100'],
        ]);

        $room = DB::transaction(function () use ($request, $memberships, $validated): Room {
            $room = Room::query()->create([
                'public_id' => Str::upper(Str::random(12)),
                'name' => $validated['name'] ?: 'Room baru',
                'created_by' => $request->user()->getKey(),
            ]);

            $memberships->join($room, $request->user());

            return $room;
        });

        return response()->json(['room' => $this->roomPayload($room)], 201);
    }

    public function join(Request $request, RoomMembershipService $memberships): JsonResponse
    {
        $validated = $request->validate([
            'room_id' => ['required', 'string', 'alpha_num', 'size:12'],
        ]);

        $room = Room::query()
            ->where('public_id', Str::upper($validated['room_id']))
            ->where('is_active', true)
            ->firstOrFail();

        $memberships->join($room, $request->user());

        return response()->json(['room' => $this->roomPayload($room)]);
    }

    public function leave(
        Request $request,
        Room $room,
        RoomMembershipService $memberships,
    ): JsonResponse|Response {
        $membership = $memberships->requireActive($room, $request->user());
        $membership->forceFill(['left_at' => now()])->save();

        return response()->noContent();
    }

    public function networkFingerprint(
        Request $request,
        Room $room,
        RoomMembershipService $memberships,
        NetworkFingerprintService $fingerprints,
    ): JsonResponse {
        $memberships->requireActive($room, $request->user());
        $ipAddress = $request->ip();
        abort_if(! is_string($ipAddress) || $ipAddress === '', 503, 'Alamat jaringan tidak dapat diverifikasi.');

        return response()->json([
            'network_fingerprint' => $fingerprints->forRoom($room, $ipAddress),
        ])->header('Cache-Control', 'no-store, private');
    }

    public function ablyToken(
        Request $request,
        Room $room,
        RoomMembershipService $memberships,
        AblyTokenService $tokens,
    ): Response {
        $memberships->requireActive($room, $request->user());
        $ipAddress = $request->ip();
        abort_if(! is_string($ipAddress) || $ipAddress === '', 503, 'Alamat jaringan tidak dapat diverifikasi.');

        return response($tokens->issueForRoom($room, $request->user(), $ipAddress))
            ->header('Content-Type', 'text/plain; charset=UTF-8')
            ->header('Cache-Control', 'no-store, private');
    }

    public function roomPayload(Room $room): array
    {
        return [
            'id' => $room->public_id,
            'name' => $room->name,
            'created_by' => $room->created_by,
            'active_members_count' => $room->active_members_count
                ?? $room->members()->whereNull('left_at')
                    ->where('last_seen_at', '>=', now()->subMinutes(30))
                    ->count(),
            'created_at' => $room->created_at?->toISOString(),
        ];
    }
}
