<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Throwable;

class MigrationController extends Controller
{
    public function index(Request $request)
    {
        $accessMode = $this->accessMode($request);

        return view('migrate', $this->pageData($accessMode, $request));
    }

    public function run(Request $request)
    {
        $accessMode = $this->accessMode($request);

        if (! $this->isConfigured($accessMode, $request)) {
            return response()->view('migrate', $this->pageData($accessMode, $request, [
                'message' => 'Migrasi belum diaktifkan. Lengkapi konfigurasi hosting lalu muat ulang halaman.',
                'success' => false,
            ]), 503);
        }

        $timestamp = filter_var($request->input('timestamp'), FILTER_VALIDATE_INT);
        $token = $request->input('token');

        if (
            $timestamp === false
            || abs(now()->timestamp - $timestamp) > 300
            || ! is_string($token)
            || ! hash_equals($this->tokenFor($timestamp), $token)
        ) {
            return response()->view('migrate', $this->pageData($accessMode, $request, [
                'message' => 'Form kedaluwarsa atau tidak valid. Muat ulang halaman lalu coba lagi.',
                'success' => false,
            ]), 419);
        }

        $credential = $request->input('credential');
        $configuredCredential = (string) config(
            $accessMode === 'remote' ? 'migration.admin_secret' : 'migration.admin_pin'
        );

        if (! is_string($credential) || ! hash_equals($configuredCredential, $credential)) {
            return response()->view('migrate', $this->pageData($accessMode, $request, [
                'message' => 'Kredensial admin tidak sesuai.',
                'success' => false,
            ]), 403);
        }

        try {
            $exitCode = Artisan::call('migrate', ['--force' => true]);
            $output = Artisan::output();

            return response()->view('migrate', $this->pageData($accessMode, $request, [
                'message' => $exitCode === 0 ? 'Migrasi berhasil dijalankan.' : 'Migrasi gagal. Periksa output di bawah.',
                'output' => $output,
                'success' => $exitCode === 0,
            ]), $exitCode === 0 ? 200 : 500);
        } catch (Throwable $exception) {
            report($exception);

            return response()->view('migrate', $this->pageData($accessMode, $request, [
                'message' => 'Migrasi gagal karena terjadi error. Detailnya tercatat di log aplikasi.',
                'output' => Artisan::output(),
                'success' => false,
            ]), 500);
        }
    }

    private function accessMode(Request $request): string
    {
        if (
            config('app.env') === 'local'
            && in_array($request->ip(), ['127.0.0.1', '::1'], true)
        ) {
            return 'local';
        }

        return 'remote';
    }

    private function isConfigured(string $accessMode, Request $request): bool
    {
        if (! filled(config('app.key'))) {
            return false;
        }

        if ($accessMode === 'local') {
            return filled(config('migration.admin_pin'));
        }

        return config('app.env') === 'production'
            && config('migration.remote_enabled')
            && $request->isSecure()
            && $this->hasStrongRemoteSecret();
    }

    private function configurationMessage(string $accessMode, Request $request): string
    {
        if ($accessMode === 'local') {
            return 'Atur MIGRATE_ADMIN_PIN dan APP_KEY di .env agar migrasi lokal dapat dijalankan.';
        }

        if (config('app.env') !== 'production') {
            return 'Atur APP_ENV=production pada .env hosting.';
        }

        if (! $request->isSecure()) {
            return 'Buka halaman melalui HTTPS agar form migrasi dapat digunakan.';
        }

        if (! config('migration.remote_enabled')) {
            return 'Atur MIGRATE_REMOTE_ENABLED=true pada .env hosting.';
        }

        if (! $this->hasStrongRemoteSecret()) {
            return 'Atur MIGRATE_ADMIN_SECRET dengan nilai acak minimal 64 karakter di .env hosting.';
        }

        return 'Atur APP_KEY pada .env hosting.';
    }

    private function hasStrongRemoteSecret(): bool
    {
        return is_string(config('migration.admin_secret'))
            && strlen(config('migration.admin_secret')) >= 64;
    }

    private function pageData(string $accessMode, Request $request, array $state = []): array
    {
        $timestamp = now()->timestamp;
        $configured = $this->isConfigured($accessMode, $request);

        return array_merge([
            'credentialConfigured' => $configured,
            'accessMessage' => $configured ? null : $this->configurationMessage($accessMode, $request),
            'accessMode' => $accessMode,
            'timestamp' => $timestamp,
            'token' => $this->tokenFor($timestamp),
            'message' => null,
            'output' => null,
            'success' => null,
        ], $state);
    }

    private function tokenFor(int $timestamp): string
    {
        return hash_hmac('sha256', 'migrate:'.$timestamp, (string) config('app.key'));
    }
}
