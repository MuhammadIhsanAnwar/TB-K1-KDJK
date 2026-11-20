<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Jalankan Migrasi Database</title>
    <style>
        :root { color-scheme: light; font-family: system-ui, sans-serif; color: #172033; background: #f3f6fb; }
        body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
        main { width: min(100%, 620px); padding: 32px; border: 1px solid #dce3ee; border-radius: 16px; background: white; box-shadow: 0 16px 40px #17203312; }
        h1 { margin: 0 0 8px; font-size: 1.65rem; }
        p { color: #536078; line-height: 1.6; }
        label { display: block; margin: 24px 0 8px; font-weight: 650; }
        input { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid #b9c4d5; border-radius: 8px; font: inherit; }
        button { margin-top: 16px; padding: 12px 18px; border: 0; border-radius: 8px; background: #2457d6; color: white; font: inherit; font-weight: 650; cursor: pointer; }
        button:disabled { background: #8793a7; cursor: not-allowed; }
        .notice { margin-top: 20px; padding: 12px 14px; border-radius: 8px; background: #eef4ff; color: #244378; }
        .error { background: #fff1f0; color: #8b2722; }
        pre { overflow: auto; max-height: 360px; padding: 16px; border-radius: 8px; background: #111827; color: #e5e7eb; white-space: pre-wrap; }
        code { font-family: ui-monospace, monospace; }
    </style>
</head>
<body>
<main>
    <h1>Jalankan Migrasi Database</h1>
    <p>
        Halaman ini hanya menjalankan <code>php artisan migrate --force</code>; perintah lain tidak dapat dijalankan.
        @if ($accessMode === 'remote')
            Akses hosting dilindungi rahasia admin dan pembatasan percobaan.
        @else
            Akses lokal dibatasi ke localhost.
        @endif
    </p>

    @if (! $credentialConfigured)
        <div class="notice error">
            {{ $accessMessage }}
        </div>
    @endif

    @if ($message)
        <div class="notice {{ $success ? '' : 'error' }}">{{ $message }}</div>
    @endif

    <form method="post" action="{{ route('migrate.run') }}">
        <input type="hidden" name="timestamp" value="{{ $timestamp }}">
        <input type="hidden" name="token" value="{{ $token }}">
        <label for="credential">{{ $accessMode === 'remote' ? 'Rahasia admin (minimal 64 karakter)' : 'PIN admin' }}</label>
        <input id="credential" name="credential" type="password" autocomplete="off" required>
        <button type="submit" {{ $credentialConfigured ? '' : 'disabled' }}>Jalankan migrasi</button>
    </form>

    @if ($output)
        <h2>Output</h2>
        <pre>{{ $output }}</pre>
    @endif
</main>
</body>
</html>
