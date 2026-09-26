package com.muse.eventbridge

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.format.DateFormat
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Date

/** Last 50 events with delivery status; refreshes itself while visible. */
class LogActivity : Activity() {
    private lateinit var summary: TextView
    private lateinit var list: LinearLayout
    private val ui = Handler(Looper.getMainLooper())
    private val refresher = object : Runnable {
        override fun run() {
            render()
            ui.postDelayed(this, 2_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        screen {
            button("Send test event") { sendTest() }
            button("Publish queued now") { retry() }
            summary = text(sizeSp = 13f)
            list = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
            addView(list)
        }
    }

    override fun onResume() {
        super.onResume()
        ui.post(refresher)
    }

    override fun onPause() {
        ui.removeCallbacks(refresher)
        super.onPause()
    }

    private fun sendTest() {
        val app = applicationContext
        NotificationTransport.io.execute {
            NotificationTransport.sendTestEvent(app) // updates the notification immediately
            ui.post { render() }
        }
        render()
    }

    private fun retry() {
        val app = applicationContext
        NotificationTransport.io.execute {
            NotificationTransport.flush(app, force = true) // publish the whole queue now
            ui.post { render() }
        }
    }

    private fun render() {
        val store = EventStore.get(this)
        val rows = store.recent(50)
        summary.text = "${store.pendingCount()} queued · showing last ${rows.size}"
        list.removeAllViews()
        val timeFormat = if (DateFormat.is24HourFormat(this)) "MMM d HH:mm:ss" else "MMM d h:mm:ss a"
        for (r in rows) {
            val time = DateFormat.format(timeFormat, Date(r.createdMs))
            // Notify rows are log-only markers; show their one-line summary as-is.
            if (r.type == EventStore.EVENT_TYPE_NOTIFY) {
                list.addView(markerRow("$time  ${r.detail ?: "notify"}", r.state))
                continue
            }
            val status = when (r.state) {
                EventStore.SENT -> "synced ✓"
                EventStore.FAILED -> "✗ ${r.detail ?: ""}"
                else -> r.detail ?: "queued"
            }
            val flag = if (r.priority == Priority.HIGH) "  ★ HIGH" else ""
            list.addView(TextView(this).apply {
                text = "$time  ${r.type}$flag\n" +
                    "${r.appLabel} (${r.packageName})\n$status"
                textSize = 13f
                setPadding(0, dp(8), 0, dp(8))
                setTextColor(
                    when (r.state) {
                        EventStore.SENT -> Color.rgb(0x1B, 0x5E, 0x20)
                        EventStore.FAILED -> Color.rgb(0xB7, 0x1C, 0x1C)
                        else -> Color.rgb(0x5D, 0x4A, 0x00)
                    }
                )
            })
        }
    }

    /** A notification-update marker: one bold line, green when published, red on failure. */
    private fun markerRow(text: String, state: String): TextView = TextView(this).apply {
        this.text = text
        textSize = 13f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(0, dp(8), 0, dp(8))
        setTextColor(
            if (state == EventStore.SENT) Color.rgb(0x1B, 0x5E, 0x20) else Color.rgb(0xB7, 0x1C, 0x1C)
        )
    }
}
