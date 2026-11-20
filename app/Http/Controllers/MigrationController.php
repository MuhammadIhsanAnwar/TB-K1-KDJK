<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Throwable;

class MigrationController extends Controller
{
    public function index(Request $request)
    {
        $this->ensureLocalRequest($request);

        return view('migrate', $this->pageData());
    }

    public function run(Request $request)
    {
        $this->ensureLocalRequest($request);

        if (! $this->isConfigured()) {
            return response()->view('migrate', $this->pageData([
                'message' => 'Konfigurasi PIN atau APP_KEY belum tersedia. Atur MIGRATE_ADMIN_PIN dan APP_KEY di .env.',
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
            return response()->view('migrate', $this->pageData([
                'message' => 'Form kedaluwarsa atau tidak valid. Muat ulang halaman lalu coba lagi.',
                'success' => false,
            ]), 419);
        }

        $pin = $request->input('pin');
        $configuredPin = (string) config('migration.admin_pin');

        if (! is_string($pin) || ! hash_equals($configuredPin, $pin)) {
            return response()->view('migrate', $this->pageData([
                'message' => 'PIN admin tidak sesuai.',
                'success' => false,
            ]), 403);
        }

        try {
            $exitCode = Artisan::call('migrate', ['--force' => true]);
            $output = Artisan::output();

            return response()->view('migrate', $this->pageData([
                'message' => $exitCode === 0 ? 'Migrasi berhasil dijalankan.' : 'Migrasi gagal. Periksa output di bawah.',
                'output' => $output,
                'success' => $exitCode === 0,
            ]), $exitCode === 0 ? 200 : 500);
        } catch (Throwable $exception) {
            report($exception);

            return response()->view('migrate', $this->pageData([
                'message' => 'Migrasi gagal karena terjadi error. Detailnya tercatat di log aplikasi.',
                'output' => Artisan::output(),
                'success' => false,
            ]), 500);
        }
    }

    private function ensureLocalRequest(Request $request): void
    {
        abort_unless(
            config('app.env') === 'local'
            && in_array($request->ip(), ['127.0.0.1', '::1'], true),
            404,
        );
    }

    private function isConfigured(): bool
    {
        return filled(config('migration.admin_pin'))
            && filled(config('app.key'));
    }

    private function pageData(array $state = []): array
    {
        $timestamp = now()->timestamp;

        return array_merge([
            'pinConfigured' => $this->isConfigured(),
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
