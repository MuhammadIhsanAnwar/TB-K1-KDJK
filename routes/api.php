<?php

use App\Http\Controllers\Api\ChatController;
use App\Http\Controllers\Api\RoomController;
use App\Http\Controllers\Api\TransferController;
use App\Http\Middleware\EnsureGuestUser;
use Illuminate\Support\Facades\Route;

Route::middleware(['web', EnsureGuestUser::class])->group(function (): void {
    Route::get('/rooms', [RoomController::class, 'index']);
    Route::post('/rooms', [RoomController::class, 'create'])->middleware('throttle:room-create');
    Route::post('/rooms/join', [RoomController::class, 'join'])->middleware('throttle:room-join');
    Route::post('/rooms/{room}/leave', [RoomController::class, 'leave']);
    Route::get('/rooms/{room}/history', [RoomController::class, 'history']);
    Route::get('/rooms/{room}/ably-token', [RoomController::class, 'ablyToken']);
    Route::post('/rooms/{room}/messages', [ChatController::class, 'store'])->middleware('throttle:chat-message');
    Route::post('/rooms/{room}/transfers', [TransferController::class, 'store'])->middleware('throttle:transfer-create');
    Route::post('/transfers/{transfer}/{action}', [TransferController::class, 'update'])
        ->whereIn('action', ['accept', 'decline', 'cancel', 'complete', 'fail']);
});
