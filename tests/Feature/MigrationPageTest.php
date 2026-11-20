<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class MigrationPageTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.limiter' => 'array']);
        Cache::store('array')->flush();
    }

    public function test_migration_page_does_not_require_a_database_session(): void
    {
        config([
            'app.env' => 'local',
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'migration.admin_pin' => '10982345',
            'session.driver' => 'database',
        ]);

        $this->get('/migrate')
            ->assertOk()
            ->assertSee('Jalankan Migrasi Database');
    }

    public function test_migration_page_explains_when_hosting_access_is_not_configured(): void
    {
        config([
            'app.env' => 'local',
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'migration.admin_pin' => '10982345',
        ]);

        $this->withServerVariables(['REMOTE_ADDR' => '192.0.2.1'])
            ->get('/migrate')
            ->assertOk()
            ->assertSee('APP_ENV=production')
            ->assertSee('disabled', false);
    }

    public function test_migration_page_rejects_an_incorrect_pin(): void
    {
        $key = 'base64:'.base64_encode(str_repeat('a', 32));

        config([
            'app.env' => 'local',
            'app.key' => $key,
            'migration.admin_pin' => '10982345',
        ]);

        $timestamp = now()->timestamp;

        $this->post('/migrate', [
            'timestamp' => $timestamp,
            'token' => hash_hmac('sha256', 'migrate:'.$timestamp, $key),
            'credential' => 'wrong-pin',
        ])->assertForbidden()
            ->assertSee('Kredensial admin tidak sesuai.');
    }

    public function test_database_failure_is_reported_without_breaking_the_page(): void
    {
        $key = 'base64:'.base64_encode(str_repeat('a', 32));

        config([
            'app.env' => 'local',
            'app.key' => $key,
            'migration.admin_pin' => '10982345',
            'database.default' => 'missing_connection',
        ]);

        $timestamp = now()->timestamp;

        $this->post('/migrate', [
            'timestamp' => $timestamp,
            'token' => hash_hmac('sha256', 'migrate:'.$timestamp, $key),
            'credential' => '10982345',
        ])->assertInternalServerError()
            ->assertSee('Migrasi gagal karena terjadi error.');
    }

    public function test_hosting_access_requires_explicit_enablement_and_a_strong_secret(): void
    {
        config([
            'app.env' => 'production',
            'app.url' => 'https://localhost',
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'migration.remote_enabled' => false,
            'migration.admin_secret' => 'short-secret',
        ]);

        $this->withServerVariables([
            'REMOTE_ADDR' => '203.0.113.10',
            'HTTPS' => 'on',
        ])
            ->get('https://localhost/migrate')
            ->assertOk()
            ->assertSee('MIGRATE_REMOTE_ENABLED=true');

        $timestamp = now()->timestamp;
        $key = 'base64:'.base64_encode(str_repeat('a', 32));
        $this->withServerVariables([
            'REMOTE_ADDR' => '203.0.113.10',
            'HTTPS' => 'on',
        ])->post('https://localhost/migrate', [
            'timestamp' => $timestamp,
            'token' => hash_hmac('sha256', 'migrate:'.$timestamp, $key),
            'credential' => 'short-secret',
        ])->assertStatus(503)
            ->assertSee('Migrasi belum diaktifkan.');

        config([
            'migration.remote_enabled' => true,
            'migration.admin_secret' => 'short-secret',
        ]);

        $this->withServerVariables([
            'REMOTE_ADDR' => '203.0.113.10',
            'HTTPS' => 'on',
        ])->get('https://localhost/migrate')
            ->assertOk()
            ->assertSee('MIGRATE_ADMIN_SECRET')
            ->assertSee('disabled', false);

        config(['migration.admin_secret' => str_repeat('b', 64)]);

        $this->withServerVariables([
            'REMOTE_ADDR' => '203.0.113.10',
            'HTTPS' => 'on',
        ])->get('https://localhost/migrate')
            ->assertOk()
            ->assertSee('Rahasia admin (minimal 64 karakter)');
    }

    public function test_hosting_requires_the_strong_secret_instead_of_local_pin(): void
    {
        $key = 'base64:'.base64_encode(str_repeat('a', 32));

        config([
            'app.env' => 'production',
            'app.url' => 'https://localhost',
            'app.key' => $key,
            'migration.remote_enabled' => true,
            'migration.admin_secret' => str_repeat('b', 64),
        ]);

        $timestamp = now()->timestamp;

        $this->withServerVariables([
            'REMOTE_ADDR' => '203.0.113.10',
            'HTTPS' => 'on',
        ])->post('/migrate', [
            'timestamp' => $timestamp,
            'token' => hash_hmac('sha256', 'migrate:'.$timestamp, $key),
            'credential' => '10982345',
        ])->assertForbidden()
            ->assertSee('Kredensial admin tidak sesuai.');

        config(['database.default' => 'missing_connection']);

        $this->withServerVariables([
            'REMOTE_ADDR' => '203.0.113.10',
            'HTTPS' => 'on',
        ])->post('https://localhost/migrate', [
            'timestamp' => $timestamp,
            'token' => hash_hmac('sha256', 'migrate:'.$timestamp, $key),
            'credential' => str_repeat('b', 64),
        ])->assertInternalServerError()
            ->assertSee('Migrasi gagal karena terjadi error.');
    }

    public function test_migration_attempts_are_rate_limited(): void
    {
        $key = 'base64:'.base64_encode(str_repeat('a', 32));

        config([
            'app.env' => 'local',
            'app.key' => $key,
            'migration.admin_pin' => '10982345',
        ]);

        $timestamp = now()->timestamp;
        $request = [
            'timestamp' => $timestamp,
            'token' => hash_hmac('sha256', 'migrate:'.$timestamp, $key),
            'credential' => 'wrong-pin',
        ];

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->post('/migrate', $request)->assertForbidden();
        }

        $this->post('/migrate', $request)->assertTooManyRequests();
    }
}
