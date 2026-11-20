<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class P2PStorageMigrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_room_member_and_message_storage_tables_are_removed(): void
    {
        foreach ([
            'file_transfers',
            'chat_messages',
            'room_members',
            'rooms',
            'personal_access_tokens',
            'password_reset_tokens',
            'sessions',
            'users',
        ] as $table) {
            $this->assertFalse(Schema::hasTable($table), "The {$table} table should not exist.");
        }
    }
}
