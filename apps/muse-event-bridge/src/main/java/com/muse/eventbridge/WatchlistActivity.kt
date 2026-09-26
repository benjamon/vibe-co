package com.muse.eventbridge

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/** Watchlisted packages are always reported and tagged priority "high". */
class WatchlistActivity : Activity() {
    private lateinit var input: EditText
    private lateinit var list: LinearLayout

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
        }
        render()
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
        list.removeAllViews()
        val prefs = Prefs(this)
        val items = prefs.watchlist.sorted()
        if (items.isEmpty()) {
            list.addView(TextView(this).apply { text = "Nothing yet."; textSize = 14f })
            return
        }
        for (pkg in items) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            row.addView(
                TextView(this).apply { text = "${appLabel(this@WatchlistActivity, pkg)}\n$pkg"; textSize = 15f },
                LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            )
            row.addView(Button(this).apply {
                text = "Remove"
                isAllCaps = false
                setOnClickListener {
                    prefs.watchlist = prefs.watchlist - pkg
                    render()
                }
            })
            list.addView(row)
        }
    }
}
