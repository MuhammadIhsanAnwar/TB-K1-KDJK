<?php

use App\Http\Controllers\Api\RoomController;
use Illuminate\Support\Facades\Route;

Route::middleware('throttle:60,1')->group(function (): void {
    Route::get('/network', [RoomController::class, 'clientIp']);
    Route::get('/network/ably-token', [RoomController::class, 'networkAblyToken']);
    Route::post('/rooms/invitation', [RoomController::class, 'createInvitation']);
    Route::get('/rooms/{roomId}/network', [RoomController::class, 'networkFingerprint'])
        ->where('roomId', '[A-Z0-9]{12}');
    Route::get('/rooms/{roomId}/ably-token', [RoomController::class, 'ablyToken'])
        ->where('roomId', '[A-Z0-9]{12}');
});
