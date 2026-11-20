<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class EnsureGuestUser
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = Auth::user();

        if ($user !== null && str_ends_with($user->email, '@guest.invalid')) {
            return $next($request);
        }

        if ($user !== null) {
            Auth::logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        $guest = User::query()->create([
            'name' => 'Tamu-'.Str::upper(Str::random(6)),
            'email' => 'guest-'.Str::uuid().'@guest.invalid',
            'password' => Str::random(64),
        ]);

        Auth::login($guest);
        $request->session()->regenerate();

        return $next($request);
    }
}
