package com.muse.eventbridge

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var grantButton: Button
    private lateinit var toggleButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        screen {
            status = text()
            grantButton = button("Grant usage access…") { open(UsageAccessActivity::class.java) }
            toggleButton = button("") { toggleMonitoring() }
            heading("CONFIGURE")
            button("Webhook settings") { open(WebhookActivity::class.java) }
            button("Watchlist") { open(WatchlistActivity::class.java) }
            button("Event log & test event") { open(LogActivity::class.java) }
            heading("PRIVACY")
            text(getString(R.string.privacy_note), sizeSp = 14f)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    override fun onResume() {
        super.onResume()
        val prefs = Prefs(this)
        // Re-assert the service if it should be running (e.g. usage access was just granted).
        if (prefs.monitoringEnabled && hasUsageAccess(this)) MonitorService.start(this)
        refresh()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        refresh()
    }

    private fun toggleMonitoring() {
        val prefs = Prefs(this)
        when {
            prefs.monitoringEnabled -> MonitorService.stop(this)
            !hasUsageAccess(this) -> {
                prefs.monitoringEnabled = true // start automatically once access is granted
                open(UsageAccessActivity::class.java)
            }
            else -> {
                MonitorService.start(this)
                if (!isHttpsUrl(prefs.endpoint)) {
                    Toast.makeText(this, "Events will queue until an https:// endpoint is set", Toast.LENGTH_LONG).show()
                }
            }
        }
        refresh()
    }

    private fun refresh() {
        val prefs = Prefs(this)
        val access = hasUsageAccess(this)
        val notifications = getSystemService(NotificationManager::class.java).areNotificationsEnabled()
        val endpoint = prefs.endpoint
        val mode = if (prefs.trackAllApps) "all apps" else "watchlist only"
        status.text = buildString {
            appendLine("Monitoring: " + if (prefs.monitoringEnabled) "ON" else "off")
            appendLine("Usage access: " + if (access) "granted ✓" else "MISSING ✗")
            appendLine("Notifications: " + if (notifications) "allowed" else "blocked (monitoring still works)")
            appendLine(
                "Endpoint: " + when {
                    endpoint.isBlank() -> "not set"
                    !isHttpsUrl(endpoint) -> "INVALID (https:// only)"
                    else -> endpoint
                }
            )
            appendLine("Tracking: $mode · ${prefs.watchlist.size} watched · every ${prefs.pollSeconds}s")
            append("Queued events: ${EventStore.get(this@MainActivity).pendingCount()}")
        }
        grantButton.visibility = if (access) android.view.View.GONE else android.view.View.VISIBLE
        toggleButton.text = if (prefs.monitoringEnabled) "Stop monitoring" else "Start monitoring"
    }

    private fun open(cls: Class<out Activity>) = startActivity(Intent(this, cls))
}
