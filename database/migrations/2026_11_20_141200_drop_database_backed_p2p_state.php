<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
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
            Schema::dropIfExists($table);
        }
    }

    public function down(): void {}
};
