<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Throwable;

class MigrationController extends Controller
{
    public function index(Request $request)
    {
        $accessMode = $this->ensureAccessibleRequest($request);

        return view('migrate', $this->pageData($accessMode));
    }

    public function run(Request $request)
    {
        $accessMode = $this->ensureAccessibleRequest($request);

        if (! $this->isConfigured($accessMode)) {
            return response()->view('migrate', $this->pageData($accessMode, [
                'message' => 'Konfigurasi kredensial atau APP_KEY belum tersedia.',
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
            return response()->view('migrate', $this->pageData($accessMode, [
                'message' => 'Form kedaluwarsa atau tidak valid. Muat ulang halaman lalu coba lagi.',
                'success' => false,
            ]), 419);
        }

        $credential = $request->input('credential');
        $configuredCredential = (string) config(
            $accessMode === 'remote' ? 'migration.admin_secret' : 'migration.admin_pin'
        );

        if (! is_string($credential) || ! hash_equals($configuredCredential, $credential)) {
            return response()->view('migrate', $this->pageData($accessMode, [
                'message' => 'Kredensial admin tidak sesuai.',
                'success' => false,
            ]), 403);
        }

        try {
            $exitCode = Artisan::call('migrate', ['--force' => true]);
            $output = Artisan::output();

            return response()->view('migrate', $this->pageData($accessMode, [
                'message' => $exitCode === 0 ? 'Migrasi berhasil dijalankan.' : 'Migrasi gagal. Periksa output di bawah.',
                'output' => $output,
                'success' => $exitCode === 0,
            ]), $exitCode === 0 ? 200 : 500);
        } catch (Throwable $exception) {
            report($exception);

            return response()->view('migrate', $this->pageData($accessMode, [
                'message' => 'Migrasi gagal karena terjadi error. Detailnya tercatat di log aplikasi.',
                'output' => Artisan::output(),
                'success' => false,
            ]), 500);
        }
    }

    private function ensureAccessibleRequest(Request $request): string
    {
        if (
            config('app.env') === 'local'
            && in_array($request->ip(), ['127.0.0.1', '::1'], true)
        ) {
            return 'local';
        }

        abort_unless(
            config('app.env') === 'production'
            && config('migration.remote_enabled')
            && $request->isSecure()
            && $this->hasStrongRemoteSecret(),
            404,
        );

        return 'remote';
    }

    private function isConfigured(string $accessMode): bool
    {
        return filled(config('app.key'))
            && ($accessMode === 'local'
                ? filled(config('migration.admin_pin'))
                : $this->hasStrongRemoteSecret());
    }

    private function hasStrongRemoteSecret(): bool
    {
        return is_string(config('migration.admin_secret'))
            && strlen(config('migration.admin_secret')) >= 64;
    }

    private function pageData(string $accessMode, array $state = []): array
    {
        $timestamp = now()->timestamp;

        return array_merge([
            'credentialConfigured' => $this->isConfigured($accessMode),
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
