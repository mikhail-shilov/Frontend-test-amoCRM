document.addEventListener(`DOMContentLoaded`, function () {
  const elMenu = document.querySelector(`#menu`)
  const elMenuButton = document.querySelector(`#menu-btn`)

  const toggleClass = `nav-menu--enable`
  const noJsClass = `nav-menu--nojs`

  elMenu.classList.remove(noJsClass)

  const menuToggleHandler = () => {

    elMenu.classList.contains(toggleClass) ? elMenu.classList.remove(toggleClass) : elMenu.classList.add(toggleClass)
  }

  elMenuButton.addEventListener(`click`, menuToggleHandler)
})
