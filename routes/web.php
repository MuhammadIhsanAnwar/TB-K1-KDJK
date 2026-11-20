<?php

use App\Http\Controllers\MigrationController;
use App\Http\Middleware\EnsureGuestUser;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\View\Middleware\ShareErrorsFromSession;

Route::get('/', function () {
    return view('sharing');
})->middleware(EnsureGuestUser::class);

Route::get('/migrate', [MigrationController::class, 'index'])
    ->middleware('throttle:30,1')
    ->withoutMiddleware([
        StartSession::class,
        ShareErrorsFromSession::class,
        PreventRequestForgery::class,
        ValidateCsrfToken::class,
        VerifyCsrfToken::class,
    ])
    ->name('migrate.index');

Route::post('/migrate', [MigrationController::class, 'run'])
    ->middleware('throttle:5,1')
    ->withoutMiddleware([
        StartSession::class,
        ShareErrorsFromSession::class,
        PreventRequestForgery::class,
        ValidateCsrfToken::class,
        VerifyCsrfToken::class,
    ])
    ->name('migrate.run');
