# Ideo
Online csv editor

# Architecture
Web gui for static website

# Data loading
- Drag and drop a file
- Copy paste content
- Upload file

# Functionality

- Validation: All rows have same length
- Display csv as table
- Select separator character automatically rerender on change
- Delete and insert columns/rows
- Sort by column
- Transpose table
- Filter (column by value equality "Only rows with `status==ok`", or if it is a number by a size comparison, or by matching a regex, filteren by empty string or explicitly non-empty strings is also important "rows without an error, so the error column is empty")
- Filter can be disabeled again
- Multiple filter can be enabeled for a single table and also for a single column.
- View (Filtered and sorted) can be saved: Download or just select and copy
- Visualy show that a column has been detected to be numeric (enabeling different filters)


---

Refinement:

Gui is not optimal. Single cells should not be scrollable but the whole table. The width of columns and the height of rows should be adjustable by dragin and dropping. The Sort, +, x take too much space. For these elements think again how to solve this more elegant.
The Drop CSV here and the past csv content should be the same field. After the succesfull import of a csv this header should be collapsed.

Also the filters take too much space. The information is fps > 400 which is very little but it uses a nested card with huge drop downs and a huge checkmark and so on.

The "Disable filters" actually deletes the filter. The button is anyway not needed. The clear sort is also not needed. Actually only the separator and transpose are needed. And the can be placed at a more convenient place. Transpose in the top left corner of the table and the separator at the import collapsible

---

The height of the rows should be as high as needed to display the full content. When changing the width of a column or the content of a cell this needs to be reaevaluated