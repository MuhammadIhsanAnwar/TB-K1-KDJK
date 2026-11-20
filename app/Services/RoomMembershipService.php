<?php

namespace App\Services;

use App\Models\Room;
use App\Models\RoomMember;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class RoomMembershipService
{
    public function requireActive(Room $room, User $user): RoomMember
    {
        $membership = RoomMember::query()
            ->where('room_id', $room->getKey())
            ->where('user_id', $user->getKey())
            ->whereNull('left_at')
            ->firstOrFail();

        $membership->forceFill(['last_seen_at' => now()])->save();

        return $membership;
    }

    public function join(Room $room, User $user): RoomMember
    {
        return DB::transaction(function () use ($room, $user): RoomMember {
            $lockedRoom = Room::query()->lockForUpdate()->findOrFail($room->getKey());

            abort_unless($lockedRoom->is_active, 404);

            $membership = RoomMember::query()
                ->where('room_id', $lockedRoom->getKey())
                ->where('user_id', $user->getKey())
                ->first();

            if ($membership !== null && $membership->left_at === null) {
                $membership->forceFill(['last_seen_at' => now()])->save();

                return $membership;
            }

            $activeCount = RoomMember::query()
                ->where('room_id', $lockedRoom->getKey())
                ->whereNull('left_at')
                ->where('last_seen_at', '>=', now()->subMinutes(30))
                ->count();

            abort_if(
                $activeCount >= config('sharing.max_room_members'),
                409,
                'Room sudah mencapai batas pengguna.',
            );

            if ($membership === null) {
                return RoomMember::query()->create([
                    'room_id' => $lockedRoom->getKey(),
                    'user_id' => $user->getKey(),
                    'joined_at' => now(),
                    'last_seen_at' => now(),
                ]);
            }

            $membership->forceFill([
                'joined_at' => now(),
                'last_seen_at' => now(),
                'left_at' => null,
            ])->save();

            return $membership;
        });
    }
}
