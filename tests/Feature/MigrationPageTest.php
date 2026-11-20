<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class MigrationPageTest extends TestCase
{
    private const TEST_PIN = 'test-admin-pin';

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
            'migration.admin_pin' => self::TEST_PIN,
            'session.driver' => 'database',
        ]);

        $this->get('/migrate')
            ->assertOk()
            ->assertSee('Jalankan Migrasi Database')
            ->assertSee('PIN admin')
            ->assertSee('migrate');
    }

    public function test_remote_migration_page_is_available_without_production_environment(): void
    {
        config([
            'app.env' => 'local',
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'migration.admin_pin' => self::TEST_PIN,
        ]);

        $this->withServerVariables([
            'REMOTE_ADDR' => '203.0.113.10',
            'HTTPS' => 'on',
        ])
            ->get('https://localhost/migrate')
            ->assertOk()
            ->assertSee('PIN admin')
            ->assertSee('<button type="submit" >Jalankan perintah</button>', false);
    }

    public function test_remote_migration_requires_https_but_page_remains_accessible(): void
    {
        $key = 'base64:'.base64_encode(str_repeat('a', 32));
        config([
            'app.env' => 'local',
            'app.key' => $key,
            'migration.admin_pin' => self::TEST_PIN,
        ]);

        $insecureRequest = [
            'REMOTE_ADDR' => '203.0.113.10',
            'HTTPS' => 'off',
            'SERVER_PORT' => 80,
        ];
        $this->withServerVariables($insecureRequest)
            ->get('http://localhost/migrate')
            ->assertOk()
            ->assertSee('HTTPS')
            ->assertSee('<button type="submit" disabled>Jalankan perintah</button>', false);

        $timestamp = now()->timestamp;
        $this->withServerVariables($insecureRequest)
            ->post('http://localhost/migrate', [
                'timestamp' => $timestamp,
                'token' => hash_hmac('sha256', 'migrate:'.$timestamp, $key),
                'credential' => self::TEST_PIN,
                'command' => 'migrate',
            ])
            ->assertStatus(503)
            ->assertSee('HTTPS');
    }

    public function test_migration_page_rejects_an_incorrect_pin(): void
    {
        $key = 'base64:'.base64_encode(str_repeat('a', 32));

        config([
            'app.env' => 'local',
            'app.key' => $key,
            'migration.admin_pin' => self::TEST_PIN,
        ]);

        $timestamp = now()->timestamp;

        $this->post('/migrate', [
            'timestamp' => $timestamp,
            'token' => hash_hmac('sha256', 'migrate:'.$timestamp, $key),
            'credential' => 'wrong-pin',
            'command' => 'migrate',
        ])->assertForbidden()
            ->assertSee('PIN admin tidak sesuai.');
    }

    public function test_only_allowlisted_artisan_commands_are_executed(): void
    {
        $key = 'base64:'.base64_encode(str_repeat('a', 32));
        config([
            'app.env' => 'local',
            'app.key' => $key,
            'migration.admin_pin' => self::TEST_PIN,
        ]);

        Artisan::shouldReceive('call')->once()->with('optimize:clear', [])->andReturn(0);
        Artisan::shouldReceive('output')->once()->andReturn('Cache optimized files cleared.');

        $timestamp = now()->timestamp;
        $this->post('/migrate', [
            'timestamp' => $timestamp,
            'token' => hash_hmac('sha256', 'migrate:'.$timestamp, $key),
            'credential' => self::TEST_PIN,
            'command' => 'optimize:clear',
        ])->assertOk()
            ->assertSee('Perintah berhasil dijalankan.')
            ->assertSee('Cache optimized files cleared.');
    }

    public function test_arbitrary_artisan_commands_are_rejected(): void
    {
        $key = 'base64:'.base64_encode(str_repeat('a', 32));
        config([
            'app.env' => 'local',
            'app.key' => $key,
            'migration.admin_pin' => self::TEST_PIN,
        ]);
        $timestamp = now()->timestamp;
        $this->post('/migrate', [
            'timestamp' => $timestamp,
            'token' => hash_hmac('sha256', 'migrate:'.$timestamp, $key),
            'credential' => self::TEST_PIN,
            'command' => 'shell:exec',
        ])->assertUnprocessable()
            ->assertSee('Perintah tidak tersedia.');
    }

    public function test_database_failure_is_reported_without_breaking_the_page(): void
    {
        $key = 'base64:'.base64_encode(str_repeat('a', 32));

        config([
            'app.env' => 'local',
            'app.key' => $key,
            'migration.admin_pin' => self::TEST_PIN,
            'database.default' => 'missing_connection',
        ]);

        $timestamp = now()->timestamp;

        $this->post('/migrate', [
            'timestamp' => $timestamp,
            'token' => hash_hmac('sha256', 'migrate:'.$timestamp, $key),
            'credential' => self::TEST_PIN,
            'command' => 'migrate',
        ])->assertInternalServerError()
            ->assertSee('Perintah gagal karena terjadi error.');
    }

    public function test_migration_attempts_are_rate_limited(): void
    {
        $key = 'base64:'.base64_encode(str_repeat('a', 32));

        config([
            'app.env' => 'local',
            'app.key' => $key,
            'migration.admin_pin' => self::TEST_PIN,
        ]);

        $timestamp = now()->timestamp;
        $request = [
            'timestamp' => $timestamp,
            'token' => hash_hmac('sha256', 'migrate:'.$timestamp, $key),
            'credential' => 'wrong-pin',
            'command' => 'migrate',
        ];

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->post('/migrate', $request)->assertForbidden();
        }

        $this->post('/migrate', $request)->assertTooManyRequests();
    }
}
