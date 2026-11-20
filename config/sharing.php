<?php

return [
    'max_room_members' => (int) env('ROOM_MAX_MEMBERS', 8),
    'max_file_size' => (int) env('SHARING_MAX_FILE_SIZE', 104857600),
    'max_message_length' => 2000,
];
