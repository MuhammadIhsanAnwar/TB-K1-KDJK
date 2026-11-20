<?php

namespace Tests\Feature;

use Tests\TestCase;

class MigrationPageTest extends TestCase
{
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

    public function test_migration_page_rejects_non_local_requests(): void
    {
        config([
            'app.env' => 'local',
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'migration.admin_pin' => '10982345',
        ]);

        $this->withServerVariables(['REMOTE_ADDR' => '192.0.2.1'])
            ->get('/migrate')
            ->assertNotFound();
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
            'pin' => 'wrong-pin',
        ])->assertForbidden()
            ->assertSee('PIN admin tidak sesuai.');
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
            'pin' => '10982345',
        ])->assertInternalServerError()
            ->assertSee('Migrasi gagal karena terjadi error.');
    }
}
