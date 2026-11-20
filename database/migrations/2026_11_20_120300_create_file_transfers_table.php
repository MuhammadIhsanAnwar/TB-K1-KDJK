<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('file_transfers', function (Blueprint $table) {
            $table->id();
            $table->uuid('public_id')->unique();
            $table->uuid('client_transfer_id');
            $table->foreignId('room_id')->constrained()->cascadeOnDelete();
            $table->foreignId('sender_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('receiver_id')->constrained('users')->cascadeOnDelete();
            $table->string('file_name', 255);
            $table->string('mime_type', 255)->nullable();
            $table->unsignedBigInteger('file_size');
            $table->string('status', 20)->default('pending')->index();
            $table->timestamps();
            $table->unique(['sender_id', 'client_transfer_id']);
            $table->index(['room_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('file_transfers');
    }
};
