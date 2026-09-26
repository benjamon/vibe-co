package com.muse.eventbridge

import android.app.Activity
import android.os.Bundle
import android.text.InputType
import android.widget.EditText
import android.widget.Switch
import android.widget.Toast

/** Transport and capture settings. The notification transport has no endpoint to configure. */
class SettingsActivity : Activity() {
    private lateinit var interval: EditText
    private lateinit var trackAll: Switch
    private lateinit var notify: Switch

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(this)
        screen {
            heading("TRANSPORT")
            notify = Switch(context).apply {
                text = "Publish events to the sync notification"
                textSize = 16f
                isChecked = prefs.notifyEnabled
            }
            addView(notify)
            text(
                "Events are written to one silent, ongoing notification (\"Muse Event Bridge\") that Muse " +
                    "reads on-device. Nothing is sent over the network. Turn this off to keep capturing into " +
                    "the queue without publishing.",
                sizeSp = 13f
            )

            heading("POLLING INTERVAL (SECONDS)")
            interval = field("$DEFAULT_POLL_SECONDS", prefs.pollSeconds.toString(), InputType.TYPE_CLASS_NUMBER)

            heading("SCOPE")
            trackAll = Switch(context).apply {
                text = "Track ALL apps (off = watchlist only)"
                textSize = 16f
                isChecked = prefs.trackAllApps
            }
            addView(trackAll)

            text("Device id: ${prefs.deviceId}", sizeSp = 12f)
            button("Save") { save() }
        }
    }

    private fun save() {
        val seconds = interval.text.toString().toIntOrNull()
        if (seconds == null || seconds !in MIN_POLL_SECONDS..MAX_POLL_SECONDS) {
            interval.error = "$MIN_POLL_SECONDS–$MAX_POLL_SECONDS seconds"
            return
        }
        val prefs = Prefs(this)
        prefs.pollSeconds = seconds
        prefs.trackAllApps = trackAll.isChecked
        prefs.notifyEnabled = notify.isChecked
        MonitorService.flushNow(this) // publish anything queued under the new settings
        Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
        finish()
    }
}
