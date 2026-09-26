package com.muse.eventbridge

import android.app.Activity
import android.graphics.Typeface
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

// Tiny view DSL: screens are built in code, so there are no layout XML files.

fun Activity.dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

fun Activity.screen(build: LinearLayout.() -> Unit): LinearLayout {
    val column = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        val pad = dp(16)
        setPadding(pad, pad, pad, pad)
        build()
    }
    setContentView(ScrollView(this).apply { addView(column) })
    return column
}

fun LinearLayout.text(value: CharSequence = "", sizeSp: Float = 16f, bold: Boolean = false): TextView =
    TextView(context).apply {
        text = value
        textSize = sizeSp
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, gap(), 0, gap())
    }.also { addView(it) }

fun LinearLayout.heading(value: CharSequence): TextView =
    text(value, sizeSp = 13f, bold = true).apply { setPadding(0, gap() * 4, 0, gap()) }

fun LinearLayout.button(label: CharSequence, onClick: (View) -> Unit): Button =
    Button(context).apply {
        text = label
        isAllCaps = false
        setOnClickListener(onClick)
    }.also { addView(it, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)) }

fun LinearLayout.field(hint: CharSequence, value: String, type: Int): EditText =
    EditText(context).apply {
        this.hint = hint
        setText(value)
        inputType = type
        isSingleLine = true
    }.also { addView(it, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)) }

private fun View.gap(): Int = (4 * resources.displayMetrics.density).toInt()
