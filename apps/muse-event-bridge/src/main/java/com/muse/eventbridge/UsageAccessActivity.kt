package com.muse.eventbridge

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast

/** PACKAGE_USAGE_STATS has no runtime dialog: explain it, then deep-link into Settings. */
class UsageAccessActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        screen {
            text("Usage access needed", sizeSp = 22f, bold = true)
            text(
                "To tell Muse which app is on screen, Muse Event Bridge needs Android's \"Usage access\". " +
                    "Android doesn't allow apps to request it with a pop-up, so you have to switch it on yourself:\n\n" +
                    "1. Tap the button below.\n" +
                    "2. Pick \"Muse Event Bridge\" if you see a list.\n" +
                    "3. Turn on \"Permit usage access\".\n" +
                    "4. Press back to return here."
            )
            text(
                "Usage access lets the app see which app is in the foreground and when. It does not reveal " +
                    "what you type, what's on screen, or your notifications.",
                sizeSp = 14f
            )
            button("Open Usage access settings") { openSettings() }
        }
    }

    override fun onResume() {
        super.onResume()
        if (hasUsageAccess(this)) {
            Toast.makeText(this, "Usage access granted", Toast.LENGTH_SHORT).show()
            if (Prefs(this).monitoringEnabled) MonitorService.start(this)
            finish()
        }
    }

    private fun openSettings() {
        // With a package: URI, Android 11+ opens this app's toggle directly; fall back to the list.
        try {
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:$packageName")))
        } catch (e: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        }
    }
}
