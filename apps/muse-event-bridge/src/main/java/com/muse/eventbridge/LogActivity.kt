package com.muse.eventbridge

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.format.DateFormat
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
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
            button("Retry queued now") { retry() }
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
        val prefs = Prefs(this)
        if (!isHttpsUrl(prefs.endpoint)) {
            Toast.makeText(this, "Set an https:// endpoint in Webhook settings first", Toast.LENGTH_LONG).show()
            return
        }
        val app = applicationContext
        EventSender.io.execute {
            EventSender.sendTestEvent(app) // immediate single POST, unaffected by batching
            ui.post { render() }
        }
        render()
    }

    private fun retry() {
        val app = applicationContext
        EventSender.io.execute {
            EventStore.get(app).makePendingDueNow()
            EventSender.flush(app, force = true) // explicit retry: send the batch now
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
            // Batch rows are log-only markers; show their one-line summary as-is.
            if (r.type == EventStore.EVENT_TYPE_BATCH) {
                list.addView(batchRow("$time  ${r.detail ?: "batch"}", r.state))
                continue
            }
            val status = when (r.state) {
                EventStore.SENT -> "HTTP ${r.httpCode} ✓"
                EventStore.FAILED -> "HTTP ${r.httpCode} ✗ ${r.detail ?: ""}"
                else -> listOfNotNull(r.httpCode?.let { "HTTP $it" }, r.detail).joinToString(" · ")
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

    /** A batch-send marker: one bold line, green when delivered, red when it failed. */
    private fun batchRow(text: String, state: String): TextView = TextView(this).apply {
        this.text = text
        textSize = 13f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(0, dp(8), 0, dp(8))
        setTextColor(
            if (state == EventStore.SENT) Color.rgb(0x1B, 0x5E, 0x20) else Color.rgb(0xB7, 0x1C, 0x1C)
        )
    }
}
