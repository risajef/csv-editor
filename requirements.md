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