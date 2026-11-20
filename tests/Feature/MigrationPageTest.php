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

    public function test_migration_page_does_not_require_a_database_session_and_shows_pin_first(): void
    {
        config([
            'app.env' => 'local',
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'migration.admin_pin' => self::TEST_PIN,
            'session.driver' => 'database',
        ]);

        $this->get('/migrate')
            ->assertOk()
            ->assertSee('Masukkan PIN admin')
            ->assertSee('name="credential"', false)
            ->assertDontSee('name="command"', false);
    }

    public function test_remote_access_works_without_production_environment_after_pin_is_verified(): void
    {
        $key = 'base64:'.base64_encode(str_repeat('a', 32));
        config([
            'app.env' => 'local',
            'app.key' => $key,
            'migration.admin_pin' => self::TEST_PIN,
        ]);

        $server = [
            'REMOTE_ADDR' => '203.0.113.10',
            'HTTPS' => 'on',
        ];

        $this->withServerVariables($server)
            ->get('https://localhost/migrate')
            ->assertOk()
            ->assertDontSee('name="command"', false);

        $this->withServerVariables($server)
            ->post('https://localhost/migrate', $this->pinPayload($key, self::TEST_PIN))
            ->assertOk()
            ->assertSee('name="command"', false)
            ->assertSee('name="access_token"', false);
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
            ->assertSee('<button type="submit" disabled>Masuk</button>', false);

        $this->withServerVariables($insecureRequest)
            ->post('http://localhost/migrate', $this->pinPayload($key, self::TEST_PIN))
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

        $this->post('/migrate', $this->pinPayload($key, 'wrong-pin'))
            ->assertForbidden()
            ->assertSee('PIN admin tidak sesuai.')
            ->assertDontSee('name="command"', false);
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

        $this->post('/migrate/run', $this->accessPayload($key, 'optimize:clear'))
            ->assertOk()
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

        $this->post('/migrate/run', $this->accessPayload($key, 'shell:exec'))
            ->assertUnprocessable()
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

        $this->post('/migrate/run', $this->accessPayload($key, 'migrate'))
            ->assertInternalServerError()
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
        $request = $this->pinPayload($key, 'wrong-pin');

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->post('/migrate', $request)->assertForbidden();
        }

        $this->post('/migrate', $request)->assertTooManyRequests();
    }

    private function pinPayload(string $key, string $pin): array
    {
        $timestamp = now()->timestamp;

        return [
            'pin_timestamp' => $timestamp,
            'pin_token' => hash_hmac('sha256', 'migrate:pin:'.$timestamp, $key),
            'credential' => $pin,
        ];
    }

    private function accessPayload(string $key, string $command): array
    {
        $expiresAt = now()->timestamp + 600;

        return [
            'access_expires' => $expiresAt,
            'access_token' => hash_hmac('sha256', 'migrate:access:'.$expiresAt, $key),
            'command' => $command,
        ];
    }
}
