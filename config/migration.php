<?php

return [
    'admin_pin' => env('MIGRATE_ADMIN_PIN'),
    'admin_secret' => env('MIGRATE_ADMIN_SECRET'),
    'remote_enabled' => (bool) env('MIGRATE_REMOTE_ENABLED', false),
];
