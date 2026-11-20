<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Throwable;

class MigrationController extends Controller
{
    private const COMMANDS = [
        'migrate' => ['--force' => true],
        'db:seed' => ['--force' => true],
        'optimize' => [],
        'optimize:clear' => [],
        'cache:clear' => [],
        'config:clear' => [],
        'route:clear' => [],
        'view:clear' => [],
    ];

    public function index(Request $request)
    {
        return view('migrate', $this->pageData($request));
    }

    public function authenticate(Request $request)
    {
        if (! $this->isConfigured($request)) {
            return response()->view('migrate', $this->pageData($request, [
                'message' => $this->configurationMessage($request),
                'success' => false,
            ]), 503);
        }

        $timestamp = filter_var($request->input('pin_timestamp'), FILTER_VALIDATE_INT);
        $token = $request->input('pin_token');

        if (
            $timestamp === false
            || abs(now()->timestamp - $timestamp) > 300
            || ! is_string($token)
            || ! hash_equals($this->tokenFor('pin', $timestamp), $token)
        ) {
            return response()->view('migrate', $this->pageData($request, [
                'message' => 'Form kedaluwarsa atau tidak valid. Muat ulang halaman lalu coba lagi.',
                'success' => false,
            ]), 419);
        }

        $credential = $request->input('credential');
        if (! is_string($credential) || ! hash_equals((string) config('migration.admin_pin'), $credential)) {
            return response()->view('migrate', $this->pageData($request, [
                'message' => 'PIN admin tidak sesuai.',
                'success' => false,
            ]), 403);
        }

        return response()->view('migrate', $this->pageData($request, array_merge(
            ['authenticated' => true],
            $this->newAccessToken(),
        )));
    }

    public function run(Request $request)
    {
        if (! $this->isConfigured($request)) {
            return response()->view('migrate', $this->pageData($request, [
                'message' => $this->configurationMessage($request),
                'success' => false,
            ]), 503);
        }

        $expiresAt = filter_var($request->input('access_expires'), FILTER_VALIDATE_INT);
        $token = $request->input('access_token');

        if (
            $expiresAt === false
            || $expiresAt < now()->timestamp
            || $expiresAt > now()->timestamp + 600
            || ! is_string($token)
            || ! hash_equals($this->tokenFor('access', $expiresAt), $token)
        ) {
            return response()->view('migrate', $this->pageData($request, [
                'message' => 'Akses kedaluwarsa. Masukkan PIN kembali.',
                'success' => false,
            ]), 419);
        }

        $accessState = array_merge(
            ['authenticated' => true],
            $this->newAccessToken(),
        );
        $command = $request->input('command');
        if (! is_string($command) || ! array_key_exists($command, self::COMMANDS)) {
            return response()->view('migrate', $this->pageData($request, array_merge($accessState, [
                'message' => 'Perintah tidak tersedia.',
                'success' => false,
            ])), 422);
        }

        try {
            $exitCode = Artisan::call($command, self::COMMANDS[$command]);
            $output = Artisan::output();

            return response()->view('migrate', $this->pageData($request, array_merge($accessState, [
                'command' => $command,
                'message' => $exitCode === 0 ? 'Perintah berhasil dijalankan.' : 'Perintah gagal. Periksa output di bawah.',
                'output' => $output,
                'success' => $exitCode === 0,
            ])), $exitCode === 0 ? 200 : 500);
        } catch (Throwable $exception) {
            report($exception);

            return response()->view('migrate', $this->pageData($request, array_merge($accessState, [
                'command' => $command,
                'message' => 'Perintah gagal karena terjadi error. Detailnya tercatat di log aplikasi.',
                'output' => Artisan::output(),
                'success' => false,
            ])), 500);
        }
    }

    private function isConfigured(Request $request): bool
    {
        return filled(config('app.key'))
            && filled(config('migration.admin_pin'))
            && ($this->isLocalRequest($request) || $request->isSecure());
    }

    private function configurationMessage(Request $request): string
    {
        if (! filled(config('app.key'))) {
            return 'APP_KEY belum diatur pada .env.';
        }

        if (! filled(config('migration.admin_pin'))) {
            return 'MIGRATE_ADMIN_PIN belum diatur pada .env.';
        }

        if (! $this->isLocalRequest($request) && ! $request->isSecure()) {
            return 'Akseskan halaman melalui HTTPS untuk mengirim PIN dengan aman.';
        }

        return 'Konfigurasi halaman migrasi belum lengkap.';
    }

    private function isLocalRequest(Request $request): bool
    {
        return in_array($request->ip(), ['127.0.0.1', '::1'], true);
    }

    private function newAccessToken(): array
    {
        $expiresAt = now()->timestamp + 600;

        return [
            'accessExpires' => $expiresAt,
            'accessToken' => $this->tokenFor('access', $expiresAt),
        ];
    }

    private function pageData(Request $request, array $state = []): array
    {
        $timestamp = now()->timestamp;
        $configured = $this->isConfigured($request);

        return array_merge([
            'authenticated' => false,
            'credentialConfigured' => $configured,
            'accessMessage' => $configured ? null : $this->configurationMessage($request),
            'accessMode' => $this->isLocalRequest($request) ? 'local' : 'remote',
            'commands' => array_keys(self::COMMANDS),
            'command' => 'migrate',
            'pinTimestamp' => $timestamp,
            'pinToken' => $this->tokenFor('pin', $timestamp),
            'accessExpires' => null,
            'accessToken' => null,
            'message' => null,
            'output' => null,
            'success' => null,
        ], $state);
    }

    private function tokenFor(string $purpose, int $timestamp): string
    {
        return hash_hmac('sha256', 'migrate:'.$purpose.':'.$timestamp, (string) config('app.key'));
    }
}
