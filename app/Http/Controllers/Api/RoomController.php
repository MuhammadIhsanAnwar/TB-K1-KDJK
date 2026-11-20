<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ChatMessage;
use App\Models\FileTransfer;
use App\Models\Room;
use App\Services\AblyPublisher;
use App\Services\AblyTokenService;
use App\Services\RoomMembershipService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

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
        AblyPublisher $ably,
        RoomController $rooms,
    ): JsonResponse|Response {
        $membership = $memberships->requireActive($room, $request->user());
        $transfers = DB::transaction(function () use ($membership, $room, $request, $rooms): array {
            $membership->forceFill(['left_at' => now()])->save();

            $transfers = $room->transfers()
                ->whereIn('status', ['pending', 'accepted'])
                ->where(fn ($query) => $query
                    ->where('sender_id', $request->user()->getKey())
                    ->orWhere('receiver_id', $request->user()->getKey()))
                ->lockForUpdate()
                ->get();
            $payloads = [];

            foreach ($transfers as $transfer) {
                $transfer->forceFill(['status' => 'cancelled'])->save();
                $transfer->load(['room', 'sender:id,name', 'receiver:id,name']);
                $payloads[] = $rooms->transferPayload($transfer);
            }

            return $payloads;
        });

        $publishFailed = false;
        foreach ($transfers as $transfer) {
            try {
                $ably->publish($room, 'transfer.updated', $transfer);
            } catch (Throwable $exception) {
                report($exception);
                $publishFailed = true;
            }
        }

        if ($publishFailed) {
            return response()->json([
                'message' => 'Room ditinggalkan, tetapi sebagian pembaruan transfer realtime gagal.',
                'saved' => true,
            ], 503);
        }

        return response()->noContent();
    }

    public function history(
        Request $request,
        Room $room,
        RoomMembershipService $memberships,
    ): JsonResponse {
        $memberships->requireActive($room, $request->user());

        $messages = $room->messages()
            ->with('user:id,name')
            ->latest('id')
            ->limit(100)
            ->get()
            ->reverse()
            ->values()
            ->map(fn (ChatMessage $message) => $this->messagePayload($message));

        $transfers = $room->transfers()
            ->with(['sender:id,name', 'receiver:id,name'])
            ->latest('id')
            ->limit(30)
            ->get()
            ->reverse()
            ->values()
            ->map(fn (FileTransfer $transfer) => $this->transferPayload($transfer));

        return response()->json([
            'room' => $this->roomPayload($room),
            'messages' => $messages,
            'transfers' => $transfers,
        ]);
    }

    public function ablyToken(
        Request $request,
        Room $room,
        RoomMembershipService $memberships,
        AblyTokenService $tokens,
    ): Response {
        $memberships->requireActive($room, $request->user());

        return response($tokens->issueForRoom($room, $request->user()))
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

    public function messagePayload(ChatMessage $message): array
    {
        return [
            'id' => $message->getKey(),
            'client_message_id' => $message->client_message_id,
            'user_id' => $message->user_id,
            'user_name' => $message->user->name,
            'body' => $message->body,
            'created_at' => $message->created_at?->toISOString(),
        ];
    }

    public function transferPayload(FileTransfer $transfer): array
    {
        return [
            'id' => $transfer->public_id,
            'room_id' => $transfer->room->public_id,
            'sender_id' => $transfer->sender_id,
            'sender_name' => $transfer->sender->name,
            'receiver_id' => $transfer->receiver_id,
            'receiver_name' => $transfer->receiver->name,
            'file_name' => $transfer->file_name,
            'mime_type' => $transfer->mime_type,
            'file_size' => $transfer->file_size,
            'status' => $transfer->status,
            'created_at' => $transfer->created_at?->toISOString(),
        ];
    }
}
