<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\FileTransfer;
use App\Models\Room;
use App\Services\AblyPublisher;
use App\Services\RoomMembershipService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

class TransferController extends Controller
{
    public function store(
        Request $request,
        Room $room,
        RoomMembershipService $memberships,
        AblyPublisher $ably,
        RoomController $rooms,
    ): JsonResponse {
        $sender = $request->user();
        $memberships->requireActive($room, $sender);

        $validated = $request->validate([
            'recipients' => ['required', 'array', 'min:1', 'max:'.max(1, config('sharing.max_room_members') - 1)],
            'recipients.*.client_transfer_id' => ['required', 'uuid'],
            'recipients.*.receiver_id' => ['required', 'integer'],
            'file_name' => ['required', 'string', 'max:255'],
            'mime_type' => ['nullable', 'string', 'max:255'],
            'file_size' => ['required', 'integer', 'min:1', 'max:'.config('sharing.max_file_size')],
        ]);

        $recipients = $validated['recipients'];
        $recipientIds = array_map(fn (array $recipient) => (int) $recipient['receiver_id'], $recipients);
        $clientTransferIds = array_column($recipients, 'client_transfer_id');

        abort_if(in_array((int) $sender->getKey(), $recipientIds, true), 422, 'Pilih pengguna lain.');
        abort_if(count(array_unique($recipientIds)) !== count($recipientIds), 422, 'Penerima tidak boleh duplikat.');
        abort_if(count(array_unique($clientTransferIds)) !== count($clientTransferIds), 422, 'ID transfer tidak boleh duplikat.');

        $activeRecipientCount = $room->members()
            ->whereIn('user_id', $recipientIds)
            ->whereNull('left_at')
            ->count();

        abort_unless($activeRecipientCount === count($recipientIds), 404, 'Satu atau beberapa penerima tidak berada di room ini.');

        $fileName = $this->safeFileName($validated['file_name']);
        abort_if($fileName === '', 422, 'Nama file tidak valid.');

        $transfers = DB::transaction(function () use ($recipients, $room, $sender, $validated, $fileName): array {
            $transfers = [];

            foreach ($recipients as $recipient) {
                $transfer = FileTransfer::query()
                    ->where('sender_id', $sender->getKey())
                    ->where('client_transfer_id', $recipient['client_transfer_id'])
                    ->first();

                if ($transfer !== null) {
                    abort_if(
                        (int) $transfer->room_id !== (int) $room->getKey()
                        || (int) $transfer->receiver_id !== (int) $recipient['receiver_id']
                        || $transfer->file_name !== $fileName
                        || $transfer->mime_type !== ($validated['mime_type'] ?? null)
                        || $transfer->file_size !== (int) $validated['file_size'],
                        409,
                        'ID transfer sudah digunakan.',
                    );
                } else {
                    $transfer = FileTransfer::query()->create([
                        'public_id' => (string) Str::uuid(),
                        'client_transfer_id' => $recipient['client_transfer_id'],
                        'room_id' => $room->getKey(),
                        'sender_id' => $sender->getKey(),
                        'receiver_id' => $recipient['receiver_id'],
                        'file_name' => $fileName,
                        'mime_type' => $validated['mime_type'] ?? null,
                        'file_size' => $validated['file_size'],
                        'status' => 'pending',
                    ]);
                }

                $transfers[] = $transfer;
            }

            return $transfers;
        });

        $payloads = [];
        foreach ($transfers as $transfer) {
            $transfer->load(['room', 'sender:id,name', 'receiver:id,name']);
            $payloads[] = $rooms->transferPayload($transfer);
        }

        $publishFailed = false;
        foreach ($payloads as $payload) {
            try {
                $ably->publish($room, 'transfer.requested', $payload);
            } catch (Throwable $exception) {
                report($exception);
                $publishFailed = true;
            }
        }

        if ($publishFailed) {
            return response()->json([
                'message' => 'Permintaan tersimpan, tetapi sebagian notifikasi realtime gagal dikirim.',
                'saved' => true,
                'transfers' => $payloads,
            ], 503);
        }

        return response()->json(['transfers' => $payloads], 201);
    }

    public function update(
        Request $request,
        FileTransfer $transfer,
        string $action,
        RoomMembershipService $memberships,
        AblyPublisher $ably,
        RoomController $rooms,
    ): JsonResponse {
        $user = $request->user();
        $memberships->requireActive($transfer->room, $user);

        $isSender = (int) $transfer->sender_id === (int) $user->getKey();
        $isReceiver = (int) $transfer->receiver_id === (int) $user->getKey();
        abort_unless($isSender || $isReceiver, 404);

        [$roleAllowed, $fromStatuses, $nextStatus] = match ($action) {
            'accept' => [$isReceiver, ['pending', 'accepted'], 'accepted'],
            'decline' => [$isReceiver, ['pending', 'declined'], 'declined'],
            'cancel' => [($isSender || $isReceiver), ['pending', 'accepted', 'cancelled'], 'cancelled'],
            'complete' => [($isSender || $isReceiver), ['accepted', 'completed'], 'completed'],
            'fail' => [($isSender || $isReceiver), ['accepted', 'failed'], 'failed'],
            default => abort(404),
        };

        abort_unless($roleAllowed, 403);
        abort_unless(in_array($transfer->status, $fromStatuses, true), 409);

        if ($transfer->status !== $nextStatus) {
            $transfer->forceFill(['status' => $nextStatus])->save();
        }

        $transfer->load(['room', 'sender:id,name', 'receiver:id,name']);
        $payload = $rooms->transferPayload($transfer);

        try {
            $ably->publish($transfer->room, 'transfer.updated', $payload);
        } catch (Throwable $exception) {
            report($exception);

            return response()->json([
                'message' => 'Status transfer tersimpan, tetapi pembaruan realtime gagal.',
                'saved' => true,
                'transfer' => $payload,
            ], 503);
        }

        return response()->json(['transfer' => $payload]);
    }

    private function safeFileName(string $fileName): string
    {
        $fileName = preg_replace('/[\x00-\x1F\x7F]/u', '', $fileName) ?? '';
        $fileName = str_replace(['/', '\\'], '_', $fileName);
        $fileName = trim($fileName, ". \t\n\r\0\x0B");

        return mb_substr($fileName, 0, 255);
    }
}
