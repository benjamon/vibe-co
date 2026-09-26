package com.muse.eventbridge

import android.app.Activity
import android.os.Bundle
import android.text.InputType
import android.widget.EditText
import android.widget.Switch
import android.widget.Toast

class WebhookActivity : Activity() {
    private lateinit var url: EditText
    private lateinit var token: EditText
    private lateinit var interval: EditText
    private lateinit var trackAll: Switch

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(this)
        screen {
            heading("ENDPOINT URL (HTTPS ONLY)")
            url = field("https://…", prefs.endpoint, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
            heading("SHARED SECRET (SENT AS X-Event-Token)")
            token = field(
                "token", prefs.token,
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            )
            heading("POLLING INTERVAL (SECONDS)")
            interval = field(
                "$DEFAULT_POLL_SECONDS", prefs.pollSeconds.toString(), InputType.TYPE_CLASS_NUMBER
            )
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
        val newUrl = url.text.toString().trim()
        if (newUrl.isNotEmpty() && !isHttpsUrl(newUrl)) {
            url.error = "Only https:// URLs are allowed"
            return
        }
        val seconds = interval.text.toString().toIntOrNull()
        if (seconds == null || seconds !in MIN_POLL_SECONDS..MAX_POLL_SECONDS) {
            interval.error = "$MIN_POLL_SECONDS–$MAX_POLL_SECONDS seconds"
            return
        }
        val prefs = Prefs(this)
        prefs.endpoint = newUrl
        prefs.token = token.text.toString()
        prefs.pollSeconds = seconds
        prefs.trackAllApps = trackAll.isChecked
        MonitorService.flushNow(this) // retry anything queued against the new settings
        Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
        finish()
    }
}
