resource "local_file" "pet" {
  filename = var.filename
  content  = var.content
  file_permission = "0700"

  lifecycle {
     create_before_destroy = true
  }
}
resource "random_pet" "my-pet" {
  prefix    = var.prefix
  separator = var.separator
  length    = var.length

  lifecycle {
    prevent_destroy = true
  }
}