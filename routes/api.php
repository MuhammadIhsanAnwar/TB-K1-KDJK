<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ChatController;
use App\Http\Controllers\Api\RoomController;
use App\Http\Controllers\Api\TransferController;
use Illuminate\Support\Facades\Route;

Route::middleware('web')->group(function (): void {
    Route::post('/auth/register', [AuthController::class, 'register'])->middleware('throttle:5,1,auth-register');
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:5,1,auth-login');

    Route::middleware('auth')->group(function (): void {
        Route::get('/auth/me', [AuthController::class, 'current']);
        Route::post('/auth/logout', [AuthController::class, 'logout']);

        Route::get('/rooms', [RoomController::class, 'index']);
        Route::post('/rooms', [RoomController::class, 'create'])->middleware('throttle:10,1,room-create');
        Route::post('/rooms/join', [RoomController::class, 'join'])->middleware('throttle:20,1,room-join');
        Route::post('/rooms/{room}/leave', [RoomController::class, 'leave']);
        Route::get('/rooms/{room}/history', [RoomController::class, 'history']);
        Route::get('/rooms/{room}/ably-token', [RoomController::class, 'ablyToken']);
        Route::post('/rooms/{room}/messages', [ChatController::class, 'store'])->middleware('throttle:30,1,chat-message');
        Route::post('/rooms/{room}/transfers', [TransferController::class, 'store'])->middleware('throttle:10,1,transfer-create');
        Route::post('/transfers/{transfer}/{action}', [TransferController::class, 'update'])
            ->whereIn('action', ['accept', 'decline', 'cancel', 'complete', 'fail']);
    });
});
