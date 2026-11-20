<?php

use App\Http\Controllers\Api\RoomController;
use App\Http\Middleware\EnsureGuestUser;
use Illuminate\Support\Facades\Route;

Route::middleware(['web', EnsureGuestUser::class])->group(function (): void {
    Route::get('/rooms', [RoomController::class, 'index']);
    Route::post('/rooms', [RoomController::class, 'create'])->middleware('throttle:room-create');
    Route::post('/rooms/join', [RoomController::class, 'join'])->middleware('throttle:room-join');
    Route::post('/rooms/{room}/leave', [RoomController::class, 'leave']);
    Route::get('/rooms/{room}/network', [RoomController::class, 'networkFingerprint']);
    Route::get('/rooms/{room}/ably-token', [RoomController::class, 'ablyToken']);
});
