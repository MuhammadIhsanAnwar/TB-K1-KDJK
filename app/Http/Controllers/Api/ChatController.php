<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ChatMessage;
use App\Models\Room;
use App\Models\User;
use App\Services\AblyPublisher;
use App\Services\RoomMembershipService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

class ChatController extends Controller
{
    public function store(
        Request $request,
        Room $room,
        RoomMembershipService $memberships,
        AblyPublisher $ably,
        RoomController $rooms,
    ): JsonResponse {
        $user = $request->user();
        $memberships->requireActive($room, $user);

        $validated = $request->validate([
            'client_message_id' => ['required', 'uuid'],
            'body' => ['required', 'string', 'max:'.config('sharing.max_message_length')],
        ]);

        $message = ChatMessage::query()
            ->where('user_id', $user->getKey())
            ->where('client_message_id', $validated['client_message_id'])
            ->first();

        if ($message !== null && (int) $message->room_id !== (int) $room->getKey()) {
            abort(409, 'ID pesan sudah digunakan.');
        }

        $message ??= ChatMessage::query()->create([
            'room_id' => $room->getKey(),
            'user_id' => $user->getKey(),
            'client_message_id' => $validated['client_message_id'],
            'body' => trim($validated['body']),
        ]);

        $message->loadMissing('user:id,name');
        $payload = $rooms->messagePayload($message);

        try {
            $ably->publish($room, 'chat.message', $payload);
        } catch (Throwable $exception) {
            report($exception);

            return response()->json([
                'message' => 'Pesan tersimpan, tetapi belum dapat dikirim secara realtime. Coba kirim ulang.',
                'saved' => true,
                'chat_message' => $payload,
            ], 503);
        }

        return response()->json(['message' => $payload], $message->wasRecentlyCreated ? 201 : 200);
    }
}
