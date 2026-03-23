<script>
	import { onMount, onDestroy } from 'svelte';
	import { writable } from 'svelte/store';

	let healthData = writable(null);
	let diagnosticsData = writable(null);
	let metricsData = writable(null);
	let loading = writable(true);
	let error = writable(null);
	let lastUpdate = writable(null);

	let healthInterval;
	let diagnosticsInterval;
	let metricsInterval;

	// Get monitoring endpoint (works for both local and render)
	const getMonitoringUrl = () => {
		const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
		if (isDev) {
			// Local: separate monitoring port
			return 'http://localhost:9090';
		}
		// For Render/production: use same domain and port (monitoring merged into main port)
		return `${window.location.origin}/api`;
	};

	const monitoringUrl = getMonitoringUrl();

	const fetchHealth = async () => {
		try {
			const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
			const url = isDev ? `${monitoringUrl}/health` : `${monitoringUrl}/health`;
			const response = await fetch(url);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = await response.json();
			healthData.set(data);
			error.set(null);
			lastUpdate.set(new Date().toLocaleTimeString());
		} catch (e) {
			error.set(`Health check failed: ${e.message}`);
			console.error('Health fetch error:', e);
		}
	};

	const fetchDiagnostics = async () => {
		try {
			const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
			const url = isDev ? `${monitoringUrl}/diagnostics` : `${monitoringUrl}/diagnostics`;
			const response = await fetch(url);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = await response.json();
			diagnosticsData.set(data);
		} catch (e) {
			console.error('Diagnostics fetch error:', e);
		}
	};

	const fetchMetrics = async () => {
		try {
			const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
			const url = isDev ? `${monitoringUrl}/metrics` : `${monitoringUrl}/metrics`;
			const response = await fetch(url);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const text = await response.text();
			const lines = text.split('\n').filter(line => !line.startsWith('#') && line.trim());
			const metrics = {};
			lines.forEach(line => {
				const match = line.match(/^([a-z_]+(?:_\d+)?)\s+(.+)$/);
				if (match) {
					metrics[match[1]] = parseFloat(match[2]);
				}
			});
			metricsData.set(metrics);
		} catch (e) {
			console.error('Metrics fetch error:', e);
		}
	};

	onMount(() => {
		// Initial fetch
		fetchHealth();
		fetchDiagnostics();
		fetchMetrics();
		loading.set(false);

		// Set up intervals
		healthInterval = setInterval(fetchHealth, 5000); // Every 5 seconds
		diagnosticsInterval = setInterval(fetchDiagnostics, 10000); // Every 10 seconds
		metricsInterval = setInterval(fetchMetrics, 15000); // Every 15 seconds
	});

	onDestroy(() => {
		clearInterval(healthInterval);
		clearInterval(diagnosticsInterval);
		clearInterval(metricsInterval);
	});

	const getStatusColor = (status) => {
		if (status === 'ok') return 'text-green-600';
		if (status === 'error') return 'text-red-600';
		return 'text-yellow-600';
	};

	const getMemoryWarning = (mb) => {
		if (mb > 800) return 'text-red-600 font-bold';
		if (mb > 500) return 'text-yellow-600';
		return 'text-green-600';
	};

	const getGoroutineWarning = (count) => {
		if (count > 10000) return 'text-red-600 font-bold';
		if (count > 5000) return 'text-yellow-600';
		return 'text-green-600';
	};

	const formatBytes = (bytes) => {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
	};
</script>

<style>
	.dashboard {
		background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
		color: #eee;
		min-height: 100vh;
		padding: 20px;
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 30px;
		padding-bottom: 20px;
		border-bottom: 2px solid #0f3460;
	}

	.title {
		font-size: 28px;
		font-weight: bold;
		color: #00d4ff;
	}

	.last-update {
		font-size: 12px;
		color: #888;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 20px;
		margin-bottom: 30px;
	}

	.card {
		background: rgba(15, 52, 96, 0.5);
		border: 1px solid #0f3460;
		border-radius: 8px;
		padding: 20px;
		transition: all 0.3s ease;
	}

	.card:hover {
		background: rgba(15, 52, 96, 0.8);
		border-color: #00d4ff;
		box-shadow: 0 0 10px rgba(0, 212, 255, 0.3);
	}

	.card-title {
		font-size: 14px;
		font-weight: bold;
		color: #00d4ff;
		margin-bottom: 15px;
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	.stat {
		display: flex;
		justify-content: space-between;
		padding: 8px 0;
		border-bottom: 1px solid rgba(0, 212, 255, 0.1);
	}

	.stat:last-child {
		border-bottom: none;
	}

	.stat-label {
		color: #aaa;
		font-size: 13px;
	}

	.stat-value {
		font-weight: bold;
		font-size: 14px;
		color: #fff;
	}

	.status-ok {
		color: #4ade80;
	}

	.status-error {
		color: #f87171;
	}

	.status-warning {
		color: #facc15;
	}

	.metric-table {
		width: 100%;
		font-size: 12px;
		border-collapse: collapse;
	}

	.metric-table th,
	.metric-table td {
		padding: 10px;
		text-align: left;
		border-bottom: 1px solid rgba(0, 212, 255, 0.1);
	}

	.metric-table th {
		background: rgba(0, 212, 255, 0.1);
		color: #00d4ff;
		font-weight: bold;
		text-transform: uppercase;
		font-size: 11px;
		letter-spacing: 1px;
	}

	.metric-table tr:hover {
		background: rgba(0, 212, 255, 0.05);
	}

	.error-message {
		background: rgba(248, 113, 113, 0.1);
		border: 1px solid #f87171;
		border-radius: 4px;
		padding: 15px;
		margin-bottom: 20px;
		color: #fca5a5;
		font-size: 13px;
	}

	.loading {
		text-align: center;
		padding: 40px;
		color: #00d4ff;
		font-size: 16px;
	}

	.progress-bar {
		width: 100%;
		height: 6px;
		background: rgba(0, 212, 255, 0.1);
		border-radius: 3px;
		overflow: hidden;
		margin-top: 8px;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #4ade80, #00d4ff);
		border-radius: 3px;
		transition: width 0.3s ease;
	}

	.refresh-indicator {
		display: inline-block;
		width: 8px;
		height: 8px;
		background: #4ade80;
		border-radius: 50%;
		margin-right: 6px;
		animation: pulse 2s infinite;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}
</style>

<div class="dashboard">
	<div class="header">
		<div>
			<div class="title">📊 Backend Monitoring Dashboard</div>
			<div class="last-update">
				<span class="refresh-indicator"></span>
				Last update: {$lastUpdate || 'loading...'}
			</div>
		</div>
		<div style="font-size: 12px; color: #888;">
			Endpoint: {monitoringUrl}
		</div>
	</div>

	{#if $error}
		<div class="error-message">
			⚠️ {$error}
		</div>
	{/if}

	{#if $loading}
		<div class="loading">Loading monitoring data...</div>
	{:else}
		<!-- Health Status Card -->
		{#if $healthData}
			<div class="grid">
				<div class="card">
					<div class="card-title">🏥 System Health</div>
					<div class="stat">
						<span class="stat-label">Status</span>
						<span class="stat-value {getStatusColor($healthData.status)}">
							{$healthData.status.toUpperCase()}
						</span>
					</div>
					<div class="stat">
						<span class="stat-label">Database</span>
						<span class="stat-value {getStatusColor($healthData.db)}">
							{$healthData.db}
						</span>
					</div>
					<div class="stat">
						<span class="stat-label">DB Connections</span>
						<span class="stat-value">{$healthData.connections}</span>
					</div>
					<div class="stat">
						<span class="stat-label">GC Runs</span>
						<span class="stat-value">{$healthData.memory.num_gc}</span>
					</div>
				</div>

				<!-- Memory Card -->
				{#if $diagnosticsData}
					<div class="card">
						<div class="card-title">💾 Memory Usage</div>
						<div class="stat">
							<span class="stat-label">Allocated</span>
							<span class="stat-value {getMemoryWarning($diagnosticsData.runtime.memory_mb.alloc)}">
								{$diagnosticsData.runtime.memory_mb.alloc} MB
							</span>
						</div>
						<div class="stat">
							<span class="stat-label">System</span>
							<span class="stat-value">
								{$diagnosticsData.runtime.memory_mb.sys} MB
							</span>
						</div>
						<div class="stat">
							<span class="stat-label">Heap Alloc</span>
							<span class="stat-value">
								{$diagnosticsData.runtime.memory_mb.heap_alloc} MB
							</span>
						</div>
						<div class="progress-bar">
							<div
								class="progress-fill"
								style="width: {Math.min(
									($diagnosticsData.runtime.memory_mb.alloc / 1000) * 100,
									100
								)}%"
							></div>
						</div>
					</div>

					<!-- Goroutines Card -->
					<div class="card">
						<div class="card-title">🔄 Goroutines</div>
						<div class="stat">
							<span class="stat-label">Active</span>
							<span class="stat-value {getGoroutineWarning($diagnosticsData.runtime.goroutines)}">
								{$diagnosticsData.runtime.goroutines}
							</span>
						</div>
						<div class="stat">
							<span class="stat-label">GC Pause</span>
							<span class="stat-value">
								{($diagnosticsData.runtime.gc.pause_ns / 1_000_000).toFixed(2)} ms
							</span>
						</div>
						<div class="progress-bar">
							<div
								class="progress-fill"
								style="width: {Math.min(
									($diagnosticsData.runtime.goroutines / 10000) * 100,
									100
								)}%"
							></div>
						</div>
					</div>

					<!-- Database Connection Pool -->
					<div class="card">
						<div class="card-title">🗄️ Database Pool</div>
						<div class="stat">
							<span class="stat-label">Open</span>
							<span class="stat-value">{$diagnosticsData.database.open_connections}</span>
						</div>
						<div class="stat">
							<span class="stat-label">In Use</span>
							<span class="stat-value">{$diagnosticsData.database.in_use}</span>
						</div>
						<div class="stat">
							<span class="stat-label">Idle</span>
							<span class="stat-value">{$diagnosticsData.database.idle}</span>
						</div>
						<div class="stat">
							<span class="stat-label">Wait Count</span>
							<span class="stat-value">{$diagnosticsData.database.wait_count}</span>
						</div>
					</div>

					<!-- Cache Info -->
					<div class="card">
						<div class="card-title">⚡ Cache</div>
						<div class="stat">
							<span class="stat-label">Size</span>
							<span class="stat-value">
								{formatBytes($diagnosticsData.cache.size_bytes)}
							</span>
						</div>
						<div class="progress-bar">
							<div
								class="progress-fill"
								style="width: {Math.min(
									($diagnosticsData.cache.size_bytes / (50 * 1024 * 1024)) * 100,
									100
								)}%"
							/>
						</div>
					</div>
				{/if}
			</div>

			<!-- Key Metrics Table -->
			{#if $metricsData}
				<div class="card">
					<div class="card-title">📈 Key Prometheus Metrics</div>
					<table class="metric-table">
						<thead>
							<tr>
								<th>Metric</th>
								<th>Value</th>
							</tr>
						</thead>
						<tbody>
							{#each Object.entries($metricsData).sort((a, b) => a[0].localeCompare(b[0])) as [key, value]}
								{#if key.includes('active') || key.includes('total') || key.includes('queue')}
									<tr>
										<td>{key}</td>
										<td>{typeof value === 'number' ? value.toFixed(0) : value}</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{/if}
	{/if}
</div>
