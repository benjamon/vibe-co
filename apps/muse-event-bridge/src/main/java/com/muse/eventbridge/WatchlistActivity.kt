package com.muse.eventbridge

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.text.format.DateUtils
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/** Watchlisted packages are always reported and tagged priority "high". */
class WatchlistActivity : Activity() {
    private lateinit var input: EditText
    private lateinit var list: LinearLayout
    private lateinit var recentList: LinearLayout
    private var recent: List<Pair<String, Long>> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        screen {
            text("Apps on the watchlist are always reported, even in watchlist-only mode, and their events carry \"priority\": \"high\".", sizeSp = 14f)
            input = field("com.example.game", "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
            button("Add package") { addTyped() }
            button("Pick from installed apps…") { pickInstalled() }
            heading("WATCHING")
            list = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
            addView(list)
            heading("RECENTLY USED (LAST 7 DAYS)")
            recentList = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
            addView(recentList)
        }
        render()
    }

    override fun onResume() {
        super.onResume()
        loadRecent()
    }

    private fun loadRecent() {
        val app = applicationContext
        NotificationTransport.io.execute {
            val apps = recentlyUsedApps(app)
            runOnUiThread {
                recent = apps
                render()
            }
        }
    }

    private fun addTyped() {
        val name = input.text.toString().trim()
        if (!isValidPackageName(name)) {
            input.error = "Not a package name (e.g. com.example.game)"
            return
        }
        add(name)
        input.setText("")
    }

    private fun add(name: String) {
        val prefs = Prefs(this)
        prefs.watchlist = prefs.watchlist + name
        render()
    }

    private fun pickInstalled() {
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        @Suppress("DEPRECATION")
        val apps = packageManager.queryIntentActivities(launcher, 0)
            .map { it.activityInfo.packageName }
            .distinct()
            .filter { it != packageName }
            .map { appLabel(this, it) to it }
            .sortedBy { it.first.lowercase() }
        AlertDialog.Builder(this)
            .setTitle("Add to watchlist")
            .setItems(apps.map { "${it.first}\n${it.second}" }.toTypedArray()) { _, i -> add(apps[i].second) }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun render() {
        val watchlist = Prefs(this).watchlist
        list.removeAllViews()
        if (watchlist.isEmpty()) list.addView(note("Nothing yet."))
        for (pkg in watchlist.sorted()) list.addView(row(pkg, appLabel(this, pkg), watched = true))

        recentList.removeAllViews()
        when {
            !hasUsageAccess(this) -> recentList.addView(note("Grant usage access to see recently used apps."))
            recent.isEmpty() -> recentList.addView(note("No recent app usage found."))
            else -> for ((pkg, lastUsed) in recent) {
                val ago = DateUtils.getRelativeTimeSpanString(
                    lastUsed, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS
                )
                recentList.addView(row(pkg, "${appLabel(this, pkg)} · $ago", watched = pkg in watchlist))
            }
        }
    }

    private fun note(value: String) = TextView(this).apply { text = value; textSize = 14f }

    /** One app with an Add/Remove toggle; both sections re-render so they stay in sync. */
    private fun row(pkg: String, title: String, watched: Boolean): LinearLayout {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(
            TextView(this).apply { text = "$title\n$pkg"; textSize = 15f },
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        )
        row.addView(Button(this).apply {
            text = if (watched) "Remove" else "Add"
            isAllCaps = false
            setOnClickListener {
                val prefs = Prefs(this@WatchlistActivity)
                prefs.watchlist = if (watched) prefs.watchlist - pkg else prefs.watchlist + pkg
                render()
            }
        })
        return row
    }
}
